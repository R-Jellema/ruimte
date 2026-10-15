import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectContent } from '@ruimte/contracts';
import { ManualClock } from '@adecore/agents/testing';
import { MAX_RESULT_LENGTH } from '../canvas/tasks.ts';
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

    test('a task is not given to an agent that runs on another machine', async () => {
        const [line] = await give();
        const nodeId = line!.split('\t')[0]!;
        const [first] = await runVerb(daemon, 'chat-lead', 'task', ['new', nodeId, '--prompt', 'and one more thing']);
        expect(first).toStartWith('refused\ttask-on-other-machine\t');
        expect(daemon.tasks.involving(nodeId)).toHaveLength(1);
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
            throw new Error('depth-limit: An agent from another machine may sit at depth 2 here, and this one would be at 3');
        };
        const [line] = await give();
        const taskId = line!.split('\t')[5]!;
        await daemon.worker.settled();
        const task = daemon.tasks.get(taskId)!;
        expect(task.status).toBe('failed');
        expect(task.result?.text).toContain('may sit at depth 2');
        expect(daemon.outbox.list().filter((entry) => entry.kind === 'start-remote-agent')).toEqual([]);
    });

    test('a team larger than the places the machine has starts the rest as places free up, and fails none', async () => {
        open = fakeLink();
        const running = new Set<string>();
        const settled = new Set<string>();
        answer = (type, payload) => {
            const { nodeId } = payload as { nodeId: string };
            if (type === 'peer.taskStart') {
                if (running.size >= 4) {
                    throw new Error('peer-busy: This machine already runs 4 tasks for that machine. Try again when one is done');
                }
                running.add(nodeId);
                return { cwd: '/studio/work', branch: null };
            }
            return settled.has(nodeId)
                ? { status: 'done', result: { text: `${nodeId} done`, source: 'turn', at: 5 }, bundle: null }
                : { status: 'open', result: null, bundle: null };
        };
        const roles = Array.from({ length: 6 }, (_, i) => ({ title: `Role ${i}`, prompt: `Do part ${i}`, provider: 'claude' }));
        const lines = await runVerb(daemon, 'chat-lead', 'team', ['--label', 'Crew', '--task', '--machine', 'Studio', '--roles', JSON.stringify(roles)]);
        const ids = lines.slice(1, 7).map((line) => line.split('\t')[0]!);
        await daemon.worker.settled();

        const started = (): number =>
            requests.filter((request) => request.type === 'peer.taskStart' && running.has((request.payload as { nodeId: string }).nodeId)).length;
        expect(started()).toBe(4);
        expect(daemon.outbox.list().filter((entry) => entry.kind === 'start-remote-agent')).toHaveLength(2);
        expect(daemon.tasks.ofParent('chat-lead').filter((task) => task.status === 'failed')).toEqual([]);

        // The machine says one settled: it frees a place, and one of the two that waited goes.
        const first = ids.find((id) => running.has(id))!;
        settled.add(first);
        running.delete(first);
        daemon.remoteTasks!.peerSettled(MACHINE, first);
        await daemon.worker.settled();
        expect(daemon.outbox.list().filter((entry) => entry.kind === 'start-remote-agent')).toHaveLength(1);

        const second = ids.find((id) => running.has(id) && id !== first)!;
        settled.add(second);
        running.delete(second);
        daemon.remoteTasks!.peerSettled(MACHINE, second);
        await daemon.worker.settled();
        expect(daemon.outbox.list().filter((entry) => entry.kind === 'start-remote-agent')).toEqual([]);
        expect(daemon.tasks.ofParent('chat-lead').filter((task) => task.status === 'failed')).toEqual([]);
        expect(daemon.tasks.ofParent('chat-lead').filter((task) => task.status === 'done')).toHaveLength(2);
    });

    test('a task a machine had no place for starts when the link opens again, with nothing on a clock', async () => {
        open = fakeLink();
        let busy = true;
        answer = (type) => {
            if (type === 'peer.taskStart' && busy) {
                throw new Error('peer-busy: This machine already runs 4 tasks for that machine');
            }
            return type === 'peer.result' ? { status: 'open', result: null, bundle: null } : { cwd: '/studio/work', branch: null };
        };
        const [line] = await give();
        const nodeId = line!.split('\t')[0]!;
        await daemon.worker.settled();
        expect(daemon.outbox.list().map((entry) => entry.kind)).toEqual(['start-remote-agent']);
        expect(daemon.outbox.list()[0]).toMatchObject({ attempts: 0 });
        clock.advance(8 * 24 * 60 * 60 * 1000);
        await daemon.worker.settled();
        expect(requests.filter((request) => request.type === 'peer.taskStart')).toHaveLength(1);

        busy = false;
        daemon.worker.wake(nodeId);
        await daemon.worker.settled();
        expect(daemon.outbox.list().map((entry) => entry.kind)).toEqual(['take-remote-result']);
    });

    test('a machine out of reach for good fails what was owed to it, with a line each, and stops what already ran', async () => {
        open = fakeLink();
        const [started] = await give();
        const [startedNode, , , , , startedTask] = started!.split('\t');
        await daemon.worker.settled();
        open = null;
        const [waiting] = await give();
        const [waitingNode, , , , , waitingTask] = waiting!.split('\t');
        await daemon.worker.settled();
        expect(
            daemon.outbox
                .list()
                .map((entry) => entry.kind)
                .sort()
        ).toEqual(['start-remote-agent', 'take-remote-result']);

        await daemon.remoteTasks!.giveUp(MACHINE);
        await daemon.worker.settled();

        expect(daemon.tasks.get(waitingTask!)).toMatchObject({ status: 'failed', result: { text: expect.stringContaining('never started there') } });
        expect(daemon.tasks.get(startedTask!)).toMatchObject({ status: 'failed', result: { text: expect.stringContaining('It is stopped there') } });
        expect(daemon.outbox.list().map((entry) => [entry.kind, entry.target])).toEqual([['stop-remote-agent', `peer:${MACHINE}`]]);
        expect(daemon.outbox.list()[0]).toMatchObject({ payload: { nodeId: startedNode } });
        expect(waitingNode).toBeDefined();

        // Once the machine answers again, the agent that ran there is stopped.
        open = fakeLink();
        daemon.worker.wake(`peer:${MACHINE}`);
        await daemon.worker.settled();
        expect(requests.at(-1)).toEqual({ type: 'peer.taskStop', payload: { nodeId: startedNode } });
    });

    test('a CLI the machine will not run for another machine fails the task for good, with the words of the machine', async () => {
        open = fakeLink();
        answer = () => {
            throw new Error('peer-provider-unsupported: Codex cannot run a task from another machine here');
        };
        const [line] = await give();
        const taskId = line!.split('\t')[5]!;
        await daemon.worker.settled();
        expect(daemon.tasks.get(taskId)).toMatchObject({ status: 'failed', result: { text: expect.stringContaining('Codex cannot run a task') } });
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

    test('a task a person stopped on the machine fails here once, with what happened there', async () => {
        open = fakeLink();
        const [line] = await give();
        const [nodeId, , , , , taskId] = line!.split('\t');
        await daemon.worker.settled();
        answer = (type) =>
            type === 'peer.result' ? { status: 'cancelled', result: { text: 'a person cleared this chat', source: 'exit', at: 5 }, bundle: null } : {};
        daemon.worker.wake(nodeId!);
        await daemon.worker.settled();
        expect(daemon.tasks.get(taskId!)).toMatchObject({
            status: 'failed',
            result: { text: 'The task was stopped on the other machine: a person cleared this chat.' }
        });
        expect(daemon.outbox.list()).toEqual([]);
    });

    test('a task whose project the machine unlinked fails here with a line that says so', async () => {
        open = fakeLink();
        const [line] = await give();
        const [nodeId, , , , , taskId] = line!.split('\t');
        await daemon.worker.settled();
        answer = (type) => {
            if (type === 'peer.result') {
                throw new Error('peer-not-linked: No project here is linked to this machine');
            }
            return {};
        };
        daemon.worker.wake(nodeId!);
        await daemon.worker.settled();
        expect(daemon.tasks.get(taskId!)).toMatchObject({ status: 'failed', result: { text: expect.stringContaining('no longer links this project') } });
    });

    test('keeps a result only as long as every task result may be, and a refusal as short as a sentence', async () => {
        open = fakeLink();
        const [line] = await give();
        const [nodeId, , , , , taskId] = line!.split('\t');
        await daemon.worker.settled();
        answer = (type) => (type === 'peer.result' ? { status: 'done', result: { text: 'x'.repeat(500_000), source: 'turn', at: 5 }, bundle: null } : {});
        daemon.worker.wake(nodeId!);
        await daemon.worker.settled();
        const text = daemon.tasks.get(taskId!)!.result!.text;
        expect(text.length).toBeLessThanOrEqual(MAX_RESULT_LENGTH);
        expect(text).toEndWith('[The rest of the result was left out.]');

        answer = () => {
            throw new Error(`depth-limit: ${'y'.repeat(100_000)}`);
        };
        const [second] = await give();
        await daemon.worker.settled();
        expect(daemon.tasks.get(second!.split('\t')[5]!)!.result!.text.length).toBeLessThan(1000);
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
