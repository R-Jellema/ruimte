import { BYTES_CHUNK_MAX, type PeerTaskStartPayload, type PeerTaskStartResult } from '@ruimte/contracts';
import { CodedError } from '@adecore/agents';
import type { TaskCoordinator, TaskStore } from '@adecore/agents/coordination';
import { BundleStore, makeBundle } from '../git/bundles.ts';
import type { CheckpointService } from '../git/checkpoints.ts';
import { errorText } from '../error-text.ts';
import type { OutboxEntry, OutboxWork, StartRemoteAgentEntry, StopRemoteAgentEntry, TakeRemoteResultEntry } from '../outbox/outbox.ts';
import { peerTarget } from './connect-peer.ts';
import type { RemoteConnections } from './remote-connections.ts';

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
    git(): { bundles: BundleStore; checkpoints: Pick<CheckpointService, 'take' | 'head'> };
    outbox: { list(): readonly OutboxEntry[]; remove(id: string): Promise<void> };
    enqueue(projectId: string, target: string, work: OutboxWork): Promise<void>;
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
        return { code: error.code, message: error.message };
    }
    const match = /^([a-z][a-z0-9-]*): (.*)$/s.exec(error instanceof Error ? error.message : '');
    return match === null || match[1] === 'internal' ? null : { code: match[1]!, message: match[2]! };
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
        return undefined;
    };

    /* Writes the checkout as a bundle and sends it a piece at a time; a transfer that stops starts over, since offset 0 starts a bundle anew. */
    private async send(
        link: NonNullable<ReturnType<RemoteConnections['link']>>,
        entry: StartRemoteAgentEntry,
        name: string
    ): Promise<{ bundleId: string; sha256: string }> {
        const { bundles, checkpoints } = this.deps.git();
        const made = await makeBundle(bundles, checkpoints, { path: entry.payload.source!, from: 'files', haves: [], name: name.slice(0, 120) });
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
        await deps.enqueue(entry.projectId, entry.target, { kind: 'take-remote-result', payload: { machineId, taskId } });
        this.deps.log?.(`Task ${taskId} runs on ${machineId} in ${started.cwd ?? 'its project'}`);
    }

    /* Waits for the task there to settle; what takes the result in is told by the link. */
    readonly take = async (entry: TakeRemoteResultEntry): Promise<'wait' | undefined> => {
        const task = this.deps.tasks.get(entry.payload.taskId);
        if (task === undefined || task.status !== 'open') {
            return undefined;
        }
        return 'wait';
    };

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
