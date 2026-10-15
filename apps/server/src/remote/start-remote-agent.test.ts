import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectContent } from '@ruimte/contracts';
import { ManualClock } from '@adecore/agents/testing';
import { projectLinks } from '../projects/project-file-test-helpers.ts';
import { ProjectStore } from '../projects/project-store.ts';
import { bootTestDaemon, runVerb, type TestDaemon } from '../tasks/test-daemon.ts';
import type { PeerLink } from './peer-connection.ts';

const MACHINE = 'machine-b';

function content(): ProjectContent {
    return {
        name: 'repo',
        color: '#123456',
        views: [
            {
                kind: 'canvas',
                id: 'main',
                name: 'Canvas',
                nodes: [{ id: 'chat-lead', kind: 'chat', title: 'Lead', x: 0, y: 0, w: 560, h: 640, provider: 'claude' }],
                texts: [],
                edges: [],
                layouts: []
            }
        ]
    };
}

let root: string;
let home: string;
let folder: string;
let store: ProjectStore;
let projectId: string;
let clock: ManualClock;
let daemon: TestDaemon;
let open: PeerLink | null;
let requests: Array<{ type: string; payload: unknown }>;
let answer: (type: string, payload: unknown) => unknown;
let owed: string[];
let linked: boolean;

function fakeLink(): PeerLink {
    return {
        request: async <T>(type: string, payload: unknown): Promise<T> => {
            requests.push({ type, payload });
            return (await answer(type, payload)) as T;
        },
        onFrame: () => () => undefined,
        onLost: () => undefined,
        close: () => undefined
    };
}

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-remote-agent-'));
    home = join(root, 'home');
    folder = join(root, 'repo');
    await mkdir(folder, { recursive: true });
    store = new ProjectStore(home, projectLinks());
    const opened = await store.openProject({ folder });
    projectId = opened.summary.projectId;
    await store.save(projectId, opened.document.rev, content());
    store.release(projectId);
    clock = new ManualClock();
    open = null;
    requests = [];
    owed = [];
    linked = true;
    answer = (type) => (type === 'peer.result' ? { status: 'open', result: null, bundle: null } : { cwd: '/studio/work', branch: null });
    daemon = await bootTestDaemon({
        home,
        store,
        clock,
        remote: {
            machines: () => (linked ? [{ machineId: MACHINE, label: 'Studio', remoteProjectId: 'remote-project', ready: true }] : []),
            connections: { link: () => open },
            reconnect: { owe: async (machineId) => void owed.push(machineId) }
        }
    });
    daemon.worker.start();
});

afterEach(async () => {
    await daemon.stop();
    store.closeAll();
    await rm(root, { recursive: true, force: true });
});

const give = (...flags: string[]): Promise<string[]> =>
    runVerb(daemon, 'chat-lead', 'agent', ['claude', '--task', 'Fix the lexer', '--prompt', 'Fix it', '--machine', 'Studio', ...flags]);

describe('agent --machine', () => {
    test('refuses a machine the project is not linked to, and lists the ones it is', async () => {
        const [first] = await runVerb(daemon, 'chat-lead', 'agent', ['claude', '--task', 'T', '--prompt', 'P', '--machine', 'Nowhere']);
        expect(first).toStartWith('refused\tmachine-not-linked\t');
        linked = false;
        const [second, ...lines] = await give();
        expect(second).toStartWith('refused\tmachine-not-linked\t');
        expect(lines.join('\n')).toContain('No machine is linked');
        expect(daemon.tasks.all()).toHaveLength(0);
    });

    test('refuses what means nothing on another machine', async () => {
        const cases: Array<[string[], string]> = [
            [['--cwd', folder], 'machine-and-cwd'],
            [['--reads', 'chat-lead'], 'machine-and-reads'],
            [['--model', 'x'], 'machine-and-model']
        ];
        for (const [flags, code] of cases) {
            const [first] = await give(...flags);
            expect(first).toStartWith(`refused\t${code}\t`);
        }
        const [noTask] = await runVerb(daemon, 'chat-lead', 'agent', ['claude', '--prompt', 'P', '--machine', 'Studio']);
        expect(noTask).toStartWith('refused\tmachine-needs-task\t');
        expect(await store.read(projectId).then((doc) => doc.views.flatMap((view) => (view.kind === 'canvas' ? view.nodes : [])))).toHaveLength(1);
    });

    test('writes the node bound to the machine, the task with it, and no line to the node', async () => {
        const [line] = await give();
        const [nodeId, kind, , provider, edge, taskId] = line!.split('\t');
        expect([kind, provider, edge]).toEqual(['chat', 'claude', '-']);
        expect(store.remote.machineOf(projectId, nodeId!)).toBe(MACHINE);
        const task = daemon.tasks.get(taskId!)!;
        expect(task).toMatchObject({ machine: MACHINE, parentId: 'chat-lead', childId: nodeId, status: 'open', title: 'Fix the lexer' });
        const doc = await store.read(projectId);
        expect(JSON.stringify(doc)).not.toContain(MACHINE);
        expect(doc.views.flatMap((view) => (view.kind === 'canvas' ? view.edges : []))).toEqual([]);
        expect(daemon.lineage.madeBy(nodeId!)).toBe('chat-lead');
    });

    test('waits while the machine is away, owes the reconnect, and starts once the link opens', async () => {
        const [line] = await give('--mode', 'supervised');
        const [nodeId, , , , , taskId] = line!.split('\t');
        await daemon.worker.settled();
        expect(requests).toEqual([]);
        expect(owed).toContain(MACHINE);
        expect(daemon.outbox.list().map((entry) => entry.kind)).toEqual(['start-remote-agent']);

        open = fakeLink();
        daemon.worker.wake(nodeId!);
        await daemon.worker.settled();

        expect(requests.filter((request) => request.type === 'peer.taskStart')).toHaveLength(1);
        expect(requests[0]).toMatchObject({
            type: 'peer.taskStart',
            payload: {
                projectId: 'remote-project',
                nodeId,
                parentId: 'chat-lead',
                title: 'Fix the lexer',
                prompt: 'Fix it',
                provider: 'claude',
                mode: 'supervised',
                depth: 1
            }
        });
        // Started is not done: the entry that takes the result in stays, and the task is still open.
        expect(daemon.outbox.list().map((entry) => entry.kind)).toEqual(['take-remote-result']);
        expect(daemon.tasks.get(taskId!)?.status).toBe('open');
    });

    test('fails the task when the machine refuses it, and wakes the parent with why', async () => {
        open = fakeLink();
        answer = () => {
            throw new Error('peer-busy: This machine already runs 4 tasks for that machine');
        };
        const [line] = await give();
        const taskId = line!.split('\t')[5]!;
        await daemon.worker.settled();
        const task = daemon.tasks.get(taskId)!;
        expect(task.status).toBe('failed');
        expect(task.result?.text).toContain('already runs 4 tasks');
        expect(daemon.outbox.list().filter((entry) => entry.kind === 'start-remote-agent')).toEqual([]);
    });

    test('a task stopped before it started is dropped without asking the machine', async () => {
        const [line] = await give();
        const nodeId = line!.split('\t')[0]!;
        await daemon.worker.settled();
        await daemon.endChildren.stopNode('chat-lead', 'a person stopped it');
        await daemon.worker.settled();
        open = fakeLink();
        daemon.worker.wake(nodeId);
        await daemon.worker.settled();
        expect(requests).toEqual([]);
        expect(daemon.outbox.list().filter((entry) => entry.kind.endsWith('remote-agent'))).toEqual([]);
        expect(daemon.tasks.get(line!.split('\t')[5]!)?.status).toBe('cancelled');
    });

    test('an agent that runs there is stopped there when its opener is stopped, and the stop waits for the link', async () => {
        open = fakeLink();
        const [line] = await give();
        const nodeId = line!.split('\t')[0]!;
        await daemon.worker.settled();
        expect(requests.map((request) => request.type)).toEqual(['peer.taskStart', 'peer.result']);

        open = null;
        await daemon.endChildren.stopNode('chat-lead', 'a person stopped it');
        await daemon.worker.settled();
        expect(daemon.outbox.list().map((entry) => entry.kind)).toEqual(['stop-remote-agent']);
        expect(requests).toHaveLength(2);

        open = fakeLink();
        daemon.worker.wake(`peer:${MACHINE}`);
        await daemon.worker.settled();
        expect(requests.at(-1)).toEqual({ type: 'peer.taskStop', payload: { nodeId } });
        expect(daemon.outbox.list()).toEqual([]);
    });

    test('a team puts every role on the machine with a task of its own, woken for once all of them settled', async () => {
        open = fakeLink();
        const roles = [
            { title: 'Lexer', prompt: 'Fix the lexer', provider: 'claude' },
            { title: 'Parser', prompt: 'Fix the parser', provider: 'claude' }
        ];
        const lines = await runVerb(daemon, 'chat-lead', 'team', ['--label', 'Crew', '--task', '--machine', 'Studio', '--roles', JSON.stringify(roles)]);
        const ids = lines.slice(1, 3).map((line) => line.split('\t')[0]!);
        await daemon.worker.settled();
        expect(ids.map((id) => store.remote.machineOf(projectId, id))).toEqual([MACHINE, MACHINE]);
        expect(requests.filter((request) => request.type === 'peer.taskStart').map((request) => (request.payload as { title: string }).title)).toEqual([
            'Lexer',
            'Parser'
        ]);
        const tasks = daemon.tasks.ofParent('chat-lead');
        expect(tasks.map((task) => [task.machine, task.batchId !== undefined])).toEqual([
            [MACHINE, true],
            [MACHINE, true]
        ]);
        expect(store.remote.machineOf(projectId, lines[0]!.split('\t')[0]!)).toBeNull();
    });

    test('keeps asking for the result while the task runs there, and settles it once, from what the machine says', async () => {
        open = fakeLink();
        const [line] = await give();
        const [nodeId, , , , , taskId] = line!.split('\t');
        await daemon.worker.settled();
        daemon.worker.wake(nodeId!);
        await daemon.worker.settled();
        expect(requests.at(-1)).toMatchObject({ type: 'peer.result', payload: { nodeId } });
        expect(daemon.tasks.get(taskId!)?.status).toBe('open');
        expect(daemon.outbox.list().map((entry) => entry.kind)).toEqual(['take-remote-result']);

        answer = (type) => (type === 'peer.result' ? { status: 'done', result: { text: 'All done', source: 'turn', at: 5 }, bundle: null } : {});
        daemon.worker.wake(nodeId!);
        await daemon.worker.settled();
        expect(daemon.tasks.get(taskId!)).toMatchObject({ status: 'done', result: { text: 'All done' } });
        expect(requests.at(-1)).toEqual({ type: 'peer.result', payload: { nodeId, ack: true } });
        expect(daemon.outbox.list()).toEqual([]);
        // Told again, it settles nothing a second time.
        expect(await daemon.wiring.coordinator.settleFromElsewhere(taskId!, { text: 'again', source: 'turn', at: 6 })).toBeNull();
    });

    test('a task that ended with the machine unreachable is acknowledged when the link is back, and a task that machine never knew fails', async () => {
        open = fakeLink();
        const [line] = await give();
        const [nodeId, , , , , taskId] = line!.split('\t');
        await daemon.worker.settled();
        // Settled here, but the daemon went down before the machine heard it had been taken in.
        await daemon.wiring.coordinator.settleFromElsewhere(taskId!, { text: 'Done', source: 'turn', at: 5 });
        open = null;
        daemon.worker.wake(nodeId!);
        await daemon.worker.settled();
        expect(daemon.outbox.list().map((entry) => entry.kind)).toEqual(['take-remote-result']);
        open = fakeLink();
        daemon.worker.wake(nodeId!);
        await daemon.worker.settled();
        expect(requests.at(-1)).toEqual({ type: 'peer.result', payload: { nodeId, ack: true } });
        expect(daemon.outbox.list()).toEqual([]);

        const [other] = await give();
        const otherTask = other!.split('\t')[5]!;
        await daemon.worker.settled();
        answer = (type) => (type === 'peer.result' ? { status: 'unknown', result: null, bundle: null } : {});
        daemon.worker.wake(other!.split('\t')[0]!);
        await daemon.worker.settled();
        expect(daemon.tasks.get(otherTask)).toMatchObject({ status: 'failed' });
    });
});
