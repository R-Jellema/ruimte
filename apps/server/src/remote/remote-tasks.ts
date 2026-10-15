import { BYTES_CHUNK_MAX, type PeerResultResult, type PeerTaskStartPayload, type PeerTaskStartResult } from '@ruimte/contracts';
import { CodedError } from '@adecore/agents';
import type { TaskCoordinator, TaskStore } from '@adecore/agents/coordination';
import { MAX_RESULT_LENGTH } from '../canvas/tasks.ts';
import { BundleStore, bundleIdFor, fetchBundle, makeBundle } from '../git/bundles.ts';
import type { CheckpointService } from '../git/checkpoints.ts';
import type { Worktrees } from '../git/worktrees.ts';
import { errorText } from '../error-text.ts';
import type { OutboxEntry, OutboxWork, StartRemoteAgentEntry, StopRemoteAgentEntry, TakeRemoteResultEntry } from '../outbox/outbox.ts';
import { RECONNECT_LIFETIME_MS, peerTarget } from './connect-peer.ts';
import type { RemoteConnections } from './remote-connections.ts';

// The words of a refusal that are kept, since the machine that refused chose them.
const MAX_REFUSAL_LENGTH = 500;

// Said where a result is cut to the length every task result has.
const CLIPPED = '\n[The rest of the result was left out.]';

// A refusal that is a place not free yet: the entry waits for the machine to say a task settled, or for the link to open again.
const WAITS: ReadonlySet<string> = new Set(['peer-busy', 'peer-bundle-limit']);

// A stop that cannot reach its machine in this long is given up on, as the reconnect is.
const STOP_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export interface RemoteTasksDeps {
    connections: Pick<RemoteConnections, 'link'>;
    /* Owes a reconnect to a machine whose link is down while work waits on it. */
    reconnect: { owe(machineId: string): Promise<void> };
    /* Tells the clients again which tasks wait for the machine; `except` is an entry that is done. */
    refresh?: (machineId: string, except?: string) => void;
    tasks: Pick<TaskStore, 'get' | 'all'>;
    coordinator: Pick<TaskCoordinator, 'settleFromElsewhere'>;
    /* Whether a project still places the node. */
    placed(nodeId: string): boolean;
    /* The git of this machine, asked for when a checkout is sent: it is wired after the outbox. */
    git(): { bundles: BundleStore; checkpoints: Pick<CheckpointService, 'take' | 'head'>; worktrees: Pick<Worktrees, 'addFresh' | 'claim'> };
    /* The folder of a project and what a project calls the machine it is linked to, for the branch that comes back. */
    folderOf(projectId: string): string | null;
    labelOf(projectId: string, machineId: string): string;
    outbox: { list(): readonly OutboxEntry[]; remove(id: string): Promise<void> };
    enqueue(projectId: string, target: string, work: OutboxWork): Promise<void>;
    /* Looks again at whatever waits on this target. */
    wake(target: string): void;
    now(): number;
    log?: (line: string) => void;
}

/*
 * What the reply of a machine that refused looks like: the code and the words it gave. A channel that
 * broke has no code, and neither has anything else that is not that machine's answer.
 */
function refusal(error: unknown): { code: string; message: string } | null {
    // The checkout could not be written as a bundle here (a repository that is not one, a bundle too large): that is an answer too.
    if (error instanceof CodedError) {
        return { code: error.code, message: error.message.slice(0, MAX_REFUSAL_LENGTH) };
    }
    const match = /^([a-z][a-z0-9-]*): (.*)$/s.exec(error instanceof Error ? error.message : '');
    return match === null || match[1] === 'internal' ? null : { code: match[1]!, message: match[2]!.slice(0, MAX_REFUSAL_LENGTH) };
}

function base64(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('base64');
}

/*
 * The tasks this machine gives agents on another machine, owed through the outbox: the start waits for
 * the link and for nothing else, and a stop of an agent that started is owed until the machine heard it.
 * Nothing here runs on a clock; the reconnect (`connect-peer.ts`) is the only thing that tries again.
 */
export class RemoteTasks {
    private readonly deps: RemoteTasksDeps;

    constructor(deps: RemoteTasksDeps) {
        this.deps = deps;
    }

    /* Sends the checkout when there is one and asks the machine to start the task. */
    readonly start = async (entry: StartRemoteAgentEntry): Promise<'wait' | undefined> => {
        const { deps } = this;
        const { machineId, taskId } = entry.payload;
        const task = deps.tasks.get(taskId);
        // Stopped or removed before it started: nothing was asked of the machine, so nothing is owed to it.
        if (task === undefined || task.status !== 'open' || !deps.placed(entry.target)) {
            return undefined;
        }
        const link = deps.connections.link(machineId);
        if (link === null) {
            await deps.reconnect.owe(machineId);
            deps.refresh?.(machineId);
            return 'wait';
        }
        let bundleId: string | null = null;
        try {
            const bundle = entry.payload.source === undefined ? undefined : await this.send(link, entry, task.title);
            bundleId = bundle?.bundleId ?? null;
            const request: PeerTaskStartPayload = {
                projectId: entry.payload.remoteProjectId,
                nodeId: entry.target,
                parentId: entry.payload.parentId,
                title: task.title,
                prompt: task.prompt,
                provider: entry.payload.provider,
                terminal: entry.payload.node === 'terminal',
                ...(entry.payload.mode === undefined ? {} : { mode: entry.payload.mode }),
                ceiling: entry.payload.ceiling,
                depth: entry.payload.depth,
                ...(bundle === undefined ? {} : { bundle: { bundleId: bundle.bundleId, sha256: bundle.sha256 } }),
                ...(entry.payload.branch === undefined ? {} : { branch: entry.payload.branch })
            };
            const started = await link.request<PeerTaskStartResult>('peer.taskStart', request);
            await this.started(entry, started);
        } catch (e) {
            // The link went while the request was out; the reconnect owes it again and this runs once it is back.
            if (deps.connections.link(machineId) === null) {
                await deps.reconnect.owe(machineId);
                deps.refresh?.(machineId);
                return 'wait';
            }
            const refused = refusal(e);
            if (refused === null) {
                throw e;
            }
            if (WAITS.has(refused.code)) {
                // The machine has no place for it yet; it says when a task settled, and a link that opens again runs this too.
                deps.refresh?.(machineId);
                return 'wait';
            }
            await deps.coordinator.settleFromElsewhere(
                taskId,
                { text: `The task could not be started on the other machine: ${refused.message}`, source: 'exit', at: deps.now() },
                'failed'
            );
        } finally {
            if (bundleId !== null) {
                await deps
                    .git()
                    .bundles.discard(bundleId)
                    .catch(() => undefined);
            }
        }
        deps.refresh?.(machineId, entry.id);
        // A checkout sent and taken in leaves room for the next one that waited for it.
        if (entry.payload.source !== undefined) {
            this.wakeStarts(machineId, entry.target);
        }
        return undefined;
    };

    /* A machine said a task of this one settled: its result is asked for, and the tasks that waited for a place try again. */
    peerSettled(machineId: string, nodeId: string): void {
        this.deps.wake(nodeId);
        this.wakeStarts(machineId, nodeId);
    }

    private wakeStarts(machineId: string, except: string): void {
        for (const entry of this.deps.outbox.list()) {
            if (entry.kind === 'start-remote-agent' && entry.payload.machineId === machineId && entry.target !== except) {
                this.deps.wake(entry.target);
            }
        }
    }

    /* Writes the checkout as a bundle and sends it a piece at a time; a transfer that stops starts over, since offset 0 starts a bundle anew. */
    private async send(
        link: NonNullable<ReturnType<RemoteConnections['link']>>,
        entry: StartRemoteAgentEntry,
        name: string
    ): Promise<{ bundleId: string; sha256: string }> {
        const { bundles, checkpoints } = this.deps.git();
        // Under the id of the task, so a second try replaces the copy the machine still holds of the first.
        const made = await makeBundle(
            bundles,
            checkpoints,
            { path: entry.payload.source!, from: 'files', haves: [], name: name.slice(0, 120) },
            bundleIdFor(entry.payload.taskId)
        );
        const file = Bun.file(bundles.pathOf(made.bundleId));
        for (let offset = 0; offset < made.size; offset += BYTES_CHUNK_MAX) {
            const piece = new Uint8Array(await file.slice(offset, Math.min(offset + BYTES_CHUNK_MAX, made.size)).arrayBuffer());
            const { received } = await link.request<{ received: number }>('peer.bundlePut', {
                bundleId: made.bundleId,
                offset,
                data: base64(piece),
                total: made.size
            });
            if (received !== offset + piece.byteLength) {
                throw new Error('The other machine lost part of the transfer');
            }
        }
        return { bundleId: made.bundleId, sha256: made.sha256 };
    }

    /* The task runs there: its result is owed from now on, and a task stopped while it started is stopped there too. */
    private async started(entry: StartRemoteAgentEntry, started: PeerTaskStartResult): Promise<void> {
        const { deps } = this;
        const { machineId, taskId } = entry.payload;
        const task = deps.tasks.get(taskId);
        if (task === undefined || task.status !== 'open' || !deps.placed(entry.target)) {
            await deps.enqueue(entry.projectId, peerTarget(machineId), { kind: 'stop-remote-agent', payload: { machineId, nodeId: entry.target } });
            return;
        }
        const base =
            entry.payload.source === undefined
                ? null
                : await deps
                      .git()
                      .checkpoints.head(entry.payload.source)
                      .catch(() => null);
        await deps.enqueue(entry.projectId, entry.target, {
            kind: 'take-remote-result',
            payload: { machineId, taskId, ...(base === null ? {} : { haves: [base] }) }
        });
        this.deps.log?.(`Task ${taskId} runs on ${machineId} in ${started.cwd ?? 'its project'}`);
    }

    /*
     * Asks the machine how the task stands, and once it settled takes the result in: the work comes back
     * as a branch here, the task settles from what the machine said (waking the parent once), and only
     * then does the machine hear that it has the result. A restart in between asks again and settles nothing twice.
     */
    readonly take = async (entry: TakeRemoteResultEntry): Promise<'wait' | undefined> => {
        const { deps } = this;
        const { machineId, taskId } = entry.payload;
        const task = deps.tasks.get(taskId);
        if (task === undefined) {
            return undefined;
        }
        const link = deps.connections.link(machineId);
        if (link === null) {
            await deps.reconnect.owe(machineId);
            deps.refresh?.(machineId);
            return 'wait';
        }
        try {
            // Settled here before: only the machine's acknowledgment is left.
            if (task.status !== 'open') {
                await link.request('peer.result', { nodeId: entry.target, ack: true });
                return undefined;
            }
            const reported = await link.request<PeerResultResult>('peer.result', {
                nodeId: entry.target,
                ...(entry.payload.haves === undefined ? {} : { haves: entry.payload.haves })
            });
            if (reported.status === 'open') {
                return 'wait';
            }
            const text = await this.settle(link, entry, task.projectId, reported);
            await link.request('peer.result', { nodeId: entry.target, ack: true });
            deps.log?.(`Task ${taskId} on ${machineId} settled: ${text.slice(0, 80)}`);
        } catch (e) {
            if (deps.connections.link(machineId) === null) {
                await deps.reconnect.owe(machineId);
                deps.refresh?.(machineId);
                return 'wait';
            }
            const refused = refusal(e);
            if (refused === null) {
                throw e;
            }
            await deps.coordinator.settleFromElsewhere(
                taskId,
                {
                    text:
                        refused.code === 'peer-not-linked'
                            ? 'The other machine no longer links this project to this one, so the task ended there.'
                            : `The other machine would not report on this task: ${refused.message}`,
                    source: 'exit',
                    at: deps.now()
                },
                'failed'
            );
        }
        return undefined;
    };

    /* Settles the task from what the machine reported, with the branch it sent back named in the result. */
    private async settle(
        link: NonNullable<ReturnType<RemoteConnections['link']>>,
        entry: TakeRemoteResultEntry,
        projectId: string,
        reported: PeerResultResult
    ): Promise<string> {
        const { deps } = this;
        if (reported.status === 'unknown') {
            const text = 'The other machine has no record of this task, so it did not run there.';
            await deps.coordinator.settleFromElsewhere(entry.payload.taskId, { text, source: 'exit', at: deps.now() }, 'failed');
            return text;
        }
        const base =
            reported.status === 'cancelled'
                ? {
                      text: `The task was stopped on the other machine${reported.result === null ? '' : `: ${reported.result.text}`}.`,
                      source: 'exit' as const,
                      at: reported.result?.at ?? deps.now()
                  }
                : (reported.result ?? { text: 'The other machine ended this task without a result.', source: 'exit' as const, at: deps.now() });
        const brought =
            reported.bundle === null
                ? null
                : await this.bringBack(link, entry, projectId, reported.bundle).catch((e: unknown) => `The work could not be brought back: ${errorText(e)}`);
        // What the machine reported is its own word and as long as it likes; what is kept and woken with is bounded.
        const room = MAX_RESULT_LENGTH - (brought === null ? 0 : brought.length + 2);
        const shown = base.text.length > room ? `${base.text.slice(0, Math.max(0, room - CLIPPED.length))}${CLIPPED}` : base.text;
        const text = brought === null ? shown : `${shown}\n\n${brought}`;
        const status = reported.status === 'done' ? 'done' : 'failed';
        await deps.coordinator.settleFromElsewhere(entry.payload.taskId, { ...base, text }, status);
        return text;
    }

    /* Reads the bundle of the machine a piece at a time and takes it in as a remote branch with a worktree on it that the node owns. */
    private async bringBack(
        link: NonNullable<ReturnType<RemoteConnections['link']>>,
        entry: TakeRemoteResultEntry,
        projectId: string,
        bundle: NonNullable<PeerResultResult['bundle']>
    ): Promise<string> {
        const { deps } = this;
        const folder = deps.folderOf(projectId);
        if (folder === null) {
            return 'The work stayed on the other machine: this project is not on this machine any more.';
        }
        const { bundles, worktrees } = deps.git();
        for (let offset = 0; offset < bundle.size;) {
            const piece = await link.request<{ size: number; data: string }>('peer.bundleRead', {
                bundleId: bundle.bundleId,
                offset,
                length: Math.min(BYTES_CHUNK_MAX, bundle.size - offset)
            });
            const bytes = Buffer.from(piece.data, 'base64');
            if (piece.size !== bundle.size || bytes.byteLength === 0) {
                throw new Error('The work changed while it was being sent');
            }
            await bundles.receive(bundle.bundleId, offset, bytes, bundle.size);
            offset += bytes.byteLength;
        }
        const taken = await fetchBundle(bundles, worktrees as Worktrees, folder, {
            projectId,
            bundleId: bundle.bundleId,
            sha256: bundle.sha256,
            branch: bundle.branch,
            into: 'remote-ref',
            machine: deps.labelOf(projectId, entry.payload.machineId)
        });
        if (taken.path !== undefined) {
            await worktrees.claim(folder, taken.path, entry.target).catch(() => undefined);
        }
        return `The work came back as the branch ${taken.branch}${taken.path === undefined ? '' : ` in the worktree ${taken.path}`}; ruimte-context worktree merge ${taken.branch} brings it into your branch.`;
    }

    /*
     * The machine stayed out of reach for as long as the reconnect tries. Each task given to it fails with a line
     * that says so, which wakes its parent once, and an agent that already runs there is owed a stop.
     */
    async giveUp(machineId: string): Promise<void> {
        const { deps } = this;
        const days = Math.round(RECONNECT_LIFETIME_MS / (24 * 60 * 60 * 1000));
        const owed = deps.outbox
            .list()
            .filter(
                (entry): entry is StartRemoteAgentEntry | TakeRemoteResultEntry =>
                    (entry.kind === 'start-remote-agent' || entry.kind === 'take-remote-result') && entry.payload.machineId === machineId
            );
        for (const entry of owed) {
            await deps.outbox.remove(entry.id);
            const text =
                entry.kind === 'start-remote-agent'
                    ? `The other machine could not be reached for ${days} days, so this task was never started there.`
                    : `The other machine could not be reached for ${days} days, so what became of this task is not known. It is stopped there when that machine answers again.`;
            await deps.coordinator.settleFromElsewhere(entry.payload.taskId, { text, source: 'exit', at: deps.now() }, 'failed');
            const stopOwed = deps.outbox.list().some((other) => other.kind === 'stop-remote-agent' && other.payload.nodeId === entry.target);
            if (entry.kind === 'take-remote-result' && !stopOwed) {
                const task = deps.tasks.get(entry.payload.taskId);
                await deps.enqueue(task?.projectId ?? entry.projectId, peerTarget(machineId), {
                    kind: 'stop-remote-agent',
                    payload: { machineId, nodeId: entry.target }
                });
            }
        }
        deps.refresh?.(machineId);
    }

    /* Tells the machine to end an agent of this one, until it heard. */
    readonly stop = async (entry: StopRemoteAgentEntry): Promise<'wait' | undefined> => {
        const { deps } = this;
        const { machineId, nodeId } = entry.payload;
        if (deps.now() - entry.createdAt >= STOP_LIFETIME_MS) {
            return undefined;
        }
        const link = deps.connections.link(machineId);
        if (link === null) {
            await deps.reconnect.owe(machineId);
            return 'wait';
        }
        try {
            await link.request('peer.taskStop', { nodeId });
            // The place it held is free.
            this.wakeStarts(machineId, nodeId);
        } catch (e) {
            if (deps.connections.link(machineId) === null) {
                await deps.reconnect.owe(machineId);
                return 'wait';
            }
            // A machine that answers with a refusal has nothing of this node to end, or will not; asking again changes neither.
            if (refusal(e) === null) {
                throw e;
            }
            deps.log?.(`The other machine would not stop ${nodeId}: ${errorText(e)}`);
        }
        return undefined;
    };

    /*
     * The agent behind a node is ended or its node is gone. What waited to start is dropped, and an agent
     * that already runs there is owed a stop, since this machine is the one that decides it ends.
     */
    async oweStop(nodeId: string): Promise<void> {
        const { deps } = this;
        const task = deps.tasks.all().findLast((candidate) => candidate.childId === nodeId && candidate.machine !== undefined);
        if (task?.machine === undefined) {
            return;
        }
        const own = deps.outbox
            .list()
            .filter((entry) => entry.target === nodeId && (entry.kind === 'start-remote-agent' || entry.kind === 'take-remote-result'));
        for (const entry of own) {
            await deps.outbox.remove(entry.id);
        }
        deps.refresh?.(task.machine);
        const owed = deps.outbox.list().some((entry) => entry.kind === 'stop-remote-agent' && entry.payload.nodeId === nodeId);
        if (own.some((entry) => entry.kind === 'take-remote-result') && !owed) {
            await deps.enqueue(task.projectId, peerTarget(task.machine), { kind: 'stop-remote-agent', payload: { machineId: task.machine, nodeId } });
        }
    }
}
