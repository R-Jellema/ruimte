import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isCanvasView, type PeerTaskStartPayload, type ProjectCanvasView, type ProjectContent } from '@ruimte/contracts';
import { AgentLineageStore, TaskStore } from '@adecore/agents/coordination';
import { Dispatcher, type ClientConnection } from '../dispatcher.ts';
import { registerPeerTaskHandlers } from '../handlers/peer-tasks.ts';
import type { OutboxEntry, OutboxWork } from '../outbox/outbox.ts';
import { peerCanvasId } from './links.ts';
import { PeerTasks, peerCaller, type PeerTasksDeps } from './peer-tasks.ts';

const MACHINE = 'machine-a';
const PROJECT = 'project-1';

let home: string;
let content: ProjectContent;
let lineage: AgentLineageStore;
let tasks: TaskStore;
let enqueued: Array<{ target: string; work: OutboxWork }>;
let prompts: Map<string, string>;
let ceiling: 'supervised' | 'auto-accept-edits' | 'auto' | 'full-access';
let linked: boolean;
let held: Array<{ clientId: string; startsLaunches: boolean | undefined }>;

function deps(): PeerTasksDeps {
    return {
        links: {
            linkOf: (machineId, projectId) =>
                linked && machineId === MACHINE && projectId === PROJECT ? { machineId, label: 'Studio', projectId, ceiling, createdAt: 0 } : null,
            touch: async () => undefined,
            canvasIdsOf: () => new Set([peerCanvasId(MACHINE)])
        },
        projects: {
            read: async () => structuredClone(content),
            mutate: async (_projectId: string, apply: (current: ProjectContent) => unknown) => {
                const mutation = (await apply(structuredClone(content))) as { content: ProjectContent | null; result: unknown };
                if (mutation.content !== null) {
                    content = mutation.content;
                }
                return mutation.result;
            },
            hold: (clientId: string, _projectId: string, options?: { startsLaunches?: boolean }) => {
                held.push({ clientId, startsLaunches: options?.startsLaunches });
            },
            letGo: () => undefined,
            index: { folderOf: () => home }
        } as unknown as PeerTasksDeps['projects'],
        lineage,
        tasks,
        outbox: { list: () => [] as readonly OutboxEntry[], remove: async () => undefined },
        enqueue: async (_projectId, target, work) => {
            enqueued.push({ target, work });
        },
        prompts: { put: async (_projectId: string, nodeId: string, prompt: string) => void prompts.set(nodeId, prompt) },
        stopNode: async () => undefined,
        installed: async () => ['claude', 'codex'],
        git: () => {
            throw new Error('no git in this test');
        },
        peerBundles: () => {
            throw new Error('no bundles in this test');
        },
        worktreePaths: async () => [],
        notify: () => undefined
    };
}

function start(overrides: Partial<PeerTaskStartPayload> = {}): PeerTaskStartPayload {
    return {
        projectId: PROJECT,
        nodeId: 'chat-one',
        parentId: 'chat-parent',
        title: 'Fix the lexer',
        prompt: 'Fix it',
        provider: 'claude',
        ceiling: 'full-access',
        depth: 1,
        ...overrides
    };
}

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-peer-tasks-'));
    lineage = new AgentLineageStore(home);
    tasks = new TaskStore(home);
    await Promise.all([lineage.load(), tasks.load()]);
    content = { name: 'One', views: [] } as unknown as ProjectContent;
    enqueued = [];
    prompts = new Map();
    ceiling = 'supervised';
    linked = true;
    held = [];
});

afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

function startEntry(): Extract<OutboxWork, { kind: 'start-agent' }>['payload'] {
    const entry = enqueued.find((item) => item.work.kind === 'start-agent')?.work;
    if (entry?.kind !== 'start-agent') {
        throw new Error('no start was owed');
    }
    return entry.payload;
}

describe('starting a task for another machine', () => {
    test('the mode is the narrowest of what it asks, what its parent allows and what the link allows', async () => {
        ceiling = 'auto-accept-edits';
        await new PeerTasks(deps()).start(MACHINE, 'client-1', start({ mode: 'auto', ceiling: 'auto' }));
        expect(startEntry()).toMatchObject({ runtimeMode: 'auto-accept-edits', ceiling: 'auto-accept-edits' });
    });

    test('a link nobody widened is supervised, whatever the other machine asks', async () => {
        await new PeerTasks(deps()).start(MACHINE, 'client-1', start({ mode: 'full-access', ceiling: 'full-access' }));
        expect(startEntry()).toMatchObject({ runtimeMode: 'supervised', ceiling: 'supervised' });
        expect(lineage.ceilingOf('chat-one')).toBe('supervised');
    });

    test('a parent narrower than the link narrows it', async () => {
        ceiling = 'full-access';
        await new PeerTasks(deps()).start(MACHINE, 'client-1', start({ ceiling: 'auto-accept-edits' }));
        expect(startEntry().ceiling).toBe('auto-accept-edits');
    });

    test("the depth is at least 1 and refused above this machine's maximum", async () => {
        const peerTasks = new PeerTasks(deps());
        await peerTasks.start(MACHINE, 'client-1', start({ depth: 0 }));
        expect(lineage.depthOf('chat-one')).toBe(1);
        await expect(peerTasks.start(MACHINE, 'client-1', start({ nodeId: 'chat-two', depth: 3 }))).rejects.toMatchObject({ code: 'depth-limit' });
        expect(lineage.peerOf('chat-two')).toBeNull();
    });

    test('everything it starts is an agent of this machine, owed to the machine, and held against its parent there', async () => {
        await new PeerTasks(deps()).start(MACHINE, 'client-1', start());
        expect(lineage.peerOf('chat-one')).toEqual({ machineId: MACHINE });
        expect(lineage.startedBy('chat-one')).toBe(peerCaller(MACHINE, 'chat-parent'));
        const [task] = tasks.all();
        expect(task).toMatchObject({ parentId: peerCanvasId(MACHINE), childId: 'chat-one', status: 'open' });
        expect(task?.machine).toBeUndefined();
        expect(prompts.get('chat-one')).toContain('Fix it');
        expect(held).toEqual([{ clientId: 'client-1', startsLaunches: false }]);
        const canvas = content.views.find((view): view is ProjectCanvasView => isCanvasView(view) && view.id === peerCanvasId(MACHINE));
        expect(canvas?.nodes.map((node) => node.id)).toEqual(['chat-one']);
    });

    test('the fifth open task of a machine is refused as busy, and a settled one frees a place', async () => {
        const peerTasks = new PeerTasks(deps());
        for (const id of ['n1', 'n2', 'n3', 'n4']) {
            await peerTasks.start(MACHINE, 'client-1', start({ nodeId: id }));
        }
        await expect(peerTasks.start(MACHINE, 'client-1', start({ nodeId: 'n5' }))).rejects.toMatchObject({ code: 'peer-busy' });
        const first = tasks.all().find((task) => task.childId === 'n1')!;
        await tasks.settle(first.id, 'done', { text: 'ok', source: 'turn', at: 1 }, 2);
        await peerTasks.start(MACHINE, 'client-1', start({ nodeId: 'n5' }));
        expect(peerTasks.openCount(MACHINE)).toBe(4);
    });

    test('asking again for a node that was started answers the same and starts nothing twice', async () => {
        const peerTasks = new PeerTasks(deps());
        await peerTasks.start(MACHINE, 'client-1', start());
        const again = await peerTasks.start(MACHINE, 'client-1', start());
        expect(again).toEqual({ cwd: home, branch: null });
        expect(tasks.all()).toHaveLength(1);
        expect(enqueued.filter((item) => item.work.kind === 'start-agent')).toHaveLength(1);
    });

    test('a machine without a link for the project gets nothing started', async () => {
        linked = false;
        await expect(new PeerTasks(deps()).start(MACHINE, 'client-1', start())).rejects.toMatchObject({ code: 'peer-not-linked' });
        expect(tasks.all()).toHaveLength(0);
    });

    test('a node of another machine with that id keeps it', async () => {
        await lineage.put({ projectId: PROJECT, nodeId: 'chat-one', openedBy: 'peer:other:x', depth: 1, agent: true, peer: { machineId: 'other' } });
        await expect(new PeerTasks(deps()).start(MACHINE, 'client-1', start())).rejects.toMatchObject({ code: 'peer-node-taken' });
    });

    test('a settled task owes its machine the result once, and an acknowledgment ends the debt', async () => {
        const owed: OutboxEntry[] = [];
        const removed: string[] = [];
        const peerTasks = new PeerTasks({
            ...deps(),
            outbox: { list: () => owed, remove: async (id) => void removed.push(id) },
            enqueue: async (projectId, target, work) => {
                enqueued.push({ target, work });
                owed.push({ ...work, id: `entry-${owed.length}`, projectId, target, createdAt: 0, attempts: 0, notBefore: 0 } as OutboxEntry);
            }
        });
        tasks.onChange((task) => peerTasks.changed(task));
        await peerTasks.start(MACHINE, 'client-1', start());
        const [task] = tasks.all();
        await tasks.settle(task!.id, 'done', { text: 'Done it', source: 'turn', at: 5 }, 6);
        await tasks.settled();
        await Promise.resolve();
        const results = enqueued.filter((item) => item.work.kind === 'deliver-remote-result');
        expect(results).toHaveLength(1);
        expect(results[0]?.target).toBe(`peer:${MACHINE}`);

        const reported = await peerTasks.result(MACHINE, 'client-1', { nodeId: 'chat-one' });
        expect(reported).toMatchObject({ status: 'done', result: { text: 'Done it' }, bundle: null });
        expect(tasks.get(task!.id)?.wake).toBe('pending');
        await peerTasks.result(MACHINE, 'client-1', { nodeId: 'chat-one', ack: true });
        expect(tasks.get(task!.id)?.wake).toBe('sent');
        expect(removed).toEqual([owed.find((entry) => entry.kind === 'deliver-remote-result')!.id]);
    });

    test('a task that is still open reports so, and another machine asks about nothing of this one', async () => {
        const peerTasks = new PeerTasks(deps());
        await peerTasks.start(MACHINE, 'client-1', start());
        expect(await peerTasks.result(MACHINE, 'client-1', { nodeId: 'chat-one' })).toEqual({ status: 'open', result: null, bundle: null });
        expect(await peerTasks.result('machine-b', 'client-2', { nodeId: 'chat-one' })).toEqual({ status: 'unknown', result: null, bundle: null });
    });

    test('a machine stops only the tasks it gave', async () => {
        const stopped: string[] = [];
        const peerTasks = new PeerTasks({ ...deps(), stopNode: async (nodeId) => void stopped.push(nodeId) });
        await peerTasks.start(MACHINE, 'client-1', start());
        await peerTasks.stop('machine-b', 'chat-one');
        expect(stopped).toEqual([]);
        await peerTasks.stop(MACHINE, 'chat-one');
        expect(stopped).toEqual(['chat-one']);
    });

    test('a bundle nobody offered this machine is not served', async () => {
        await expect(new PeerTasks(deps()).bundleRead(MACHINE, { bundleId: 'a-bundle-id', offset: 0, length: 10 })).rejects.toMatchObject({
            code: 'bundle-missing'
        });
    });
});

describe('the requests a peer may ask', () => {
    const connection = (machineId: string | undefined): ClientConnection => {
        const sent: unknown[] = [];
        return {
            id: 'client-1',
            access: { reachability: 'public', sessionId: 'session', ...(machineId === undefined ? {} : { peer: { machineId } }) },
            send: (frame) => void sent.push(frame)
        };
    };

    async function ask(client: ClientConnection, type: string, payload: unknown): Promise<{ ok: boolean; error?: { code: string } }> {
        const dispatcher = new Dispatcher();
        registerPeerTaskHandlers(
            dispatcher,
            { list: () => (linked ? [{ machineId: MACHINE, label: 'Studio', projectId: PROJECT, ceiling, createdAt: 0 }] : []) },
            new PeerTasks(deps())
        );
        const frames: Array<{ ok: boolean; error?: { code: string } }> = [];
        await dispatcher.handle({ ...client, send: (frame) => void frames.push(frame as never) }, JSON.stringify({ id: 'r', type, payload }));
        return frames[0]!;
    }

    const PAYLOADS: Record<string, unknown> = {
        'peer.taskStart': start(),
        'peer.taskStop': { nodeId: 'chat-one' },
        'peer.result': { nodeId: 'chat-one' },
        'peer.bundlePut': { bundleId: 'a-bundle-id', offset: 0, data: '' },
        'peer.bundleRead': { bundleId: 'a-bundle-id', offset: 0, length: 10 },
        'peer.close': { projectId: PROJECT }
    };

    test('every one of them answers peer-not-linked to a machine without a link', async () => {
        linked = false;
        for (const [type, payload] of Object.entries(PAYLOADS)) {
            expect(await ask(connection(MACHINE), type, payload)).toMatchObject({ ok: false, error: { code: 'peer-not-linked' } });
        }
    });

    test('every one of them is closed to a client that is not a peer', async () => {
        for (const [type, payload] of Object.entries(PAYLOADS)) {
            const frame = await ask(connection(undefined), type, payload);
            expect(frame.ok).toBe(false);
        }
    });

    test('with a link, a task starts', async () => {
        expect(await ask(connection(MACHINE), 'peer.taskStart', start())).toMatchObject({ ok: true });
    });
});
