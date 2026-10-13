import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { appendFile, cp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChatInfo, ChatItem, ChatSubagentItem } from '@ruimte/contracts';
import { ChatManager } from './chat-manager.ts';
import { FakeWatch } from '@adecore/agents/testing';
import { makeChatFixture, retire, FIXTURE } from './chat-manager.fixture.test.ts';

type ChatFixture = Awaited<ReturnType<typeof makeChatFixture>>;
let home: ChatFixture['home'];
let store: ChatFixture['store'];
let claude: ChatFixture['claude'];
let manager: ChatFixture['manager'];
let recorder: ChatFixture['recorder'];
let makeManager: ChatFixture['makeManager'];
function idle() {
    return recorder.info?.status === 'idle' && recorder.info.running && recorder.info.activeTurnId === null;
}
let subagentWork: ChatFixture['subagentWork'];
beforeEach(async () => {
    ({ home, store, claude, manager, recorder, makeManager, subagentWork } = await makeChatFixture());
});
afterEach(async () => {
    await retire(manager);
    await rm(home, { recursive: true, force: true });
});

test('an agent a background subagent opened hangs under it, and the turn it wakes is about its parent', async () => {
    await manager.create({ chatId: 'chat-nested', cwd: home });
    manager.attach('chat-nested', 'c1');
    await manager.send('chat-nested', 'nested: the chain is done');
    await recorder.until(idle);

    claude.started[0]!.runLater();
    await recorder.until(() => recorder.ofKind('turn').length === 2 && idle());
    const [middle, leaf] = recorder.ofKind('subagent');
    expect(middle).toMatchObject({ toolUseId: 'toolu_middle', status: 'done', background: true, result: 'the leaf said PONG' });
    expect(middle).not.toHaveProperty('parentToolUseId');
    expect(leaf).toMatchObject({ toolUseId: 'toolu_leaf', parentToolUseId: 'toolu_middle', status: 'done', result: 'PONG', turnId: middle!.turnId });
    // No tool row for the grandchild's call, beside the row that already stands for it.
    expect(recorder.ofKind('tool')).toEqual([]);
    expect(recorder.ofKind('turn')[1]).toMatchObject({ origin: 'agent', label: 'the chain is done', taskToolUseId: 'toolu_middle' });
});

test("a workflow's row carries its phases and agents from the progress reports, and settles with its task", async () => {
    await manager.create({ chatId: 'chat-wf', cwd: home });
    manager.attach('chat-wf', 'c1');
    await manager.send('chat-wf', 'workflow: Write a file, then read it');
    await recorder.until(idle);
    const phases = [
        { index: 1, title: 'Write' },
        { index: 2, title: 'Read' }
    ];
    expect(recorder.ofKind('tool')[0]).toMatchObject({
        name: 'Workflow',
        state: 'running',
        workflow: { name: 'write-and-read', phases, agents: [{ label: 'write-file', phaseIndex: 1, agentId: 'a-writer', status: 'running' }] }
    });

    claude.started[0]!.runLater();
    await recorder.until(() => recorder.ofKind('turn').length === 2 && idle());
    expect(recorder.ofKind('tool')[0]).toMatchObject({
        state: 'done',
        workflow: {
            name: 'write-and-read',
            phases,
            agents: [
                { label: 'write-file', status: 'done', durationMs: 5000, lastTool: 'Write' },
                { label: 'read-file', phaseIndex: 2, agentId: 'a-reader', status: 'done', startedAt: 6000, durationMs: 4000 }
            ]
        }
    });
});

test("a background agent's approval outlives the turn, and a person allowing it later lets the agent finish", async () => {
    await manager.create({ chatId: 'chat-ask', cwd: home });
    manager.attach('chat-ask', 'c1');
    await manager.send('chat-ask', 'background approval: ls');
    await recorder.until(() => recorder.ofKind('turn')[0]?.state === 'done');

    expect(recorder.items.get('approval-req-bg')).toMatchObject({ decision: 'pending', toolName: 'Bash', toolUseId: 'toolu_bgask_bash' });
    expect(recorder.info).toMatchObject({ status: 'needs-you', activeTurnId: null });

    manager.approve('chat-ask', 'req-bg', 'allow');
    expect(recorder.items.get('approval-req-bg')).toMatchObject({ decision: 'allow' });
    await recorder.until(() => recorder.ofKind('turn')[1]?.state === 'done' && idle());
    expect(recorder.ofKind('turn')[1]).toMatchObject({ origin: 'agent' });
    expect(recorder.ofKind('subagent')[0]).toMatchObject({ toolUseId: 'toolu_bgask', status: 'done' });
    expect(subagentWork().find((item) => item.kind === 'tool')).toMatchObject({ output: 'ran: ls', state: 'done' });
});

test("a message after a background agent asked between turns settles on the CLI's own result", async () => {
    await manager.create({ chatId: 'chat-late-ask', cwd: home });
    manager.attach('chat-late-ask', 'c1');
    await manager.send('chat-late-ask', 'background approval: ls\nlate');
    await recorder.until(() => recorder.ofKind('turn')[0]?.state === 'done' && idle());

    claude.started[0]!.runLater();
    await recorder.until(() => recorder.items.get('approval-req-bg') !== undefined);
    expect(recorder.ofKind('turn')).toHaveLength(1);
    expect(recorder.items.get('approval-req-bg')).toMatchObject({ decision: 'pending', toolUseId: 'toolu_bgask_bash' });
    expect(recorder.info).toMatchObject({ status: 'needs-you', activeTurnId: null });

    expect(await manager.send('chat-late-ask', 'hello')).toMatchObject({ queued: false });
    await recorder.until(() => recorder.ofKind('turn')[1]?.state === 'done');
    expect(recorder.ofKind('turn')).toHaveLength(2);
    expect(recorder.ofKind('turn')[1]).toMatchObject({ origin: 'user', state: 'done' });
    expect(recorder.items.get('approval-req-bg')).toMatchObject({ decision: 'pending' });
    expect(recorder.info).toMatchObject({ status: 'needs-you', activeTurnId: null });
});

test("stopping the turn cancels a background agent's approval and turns it down for the CLI", async () => {
    await manager.create({ chatId: 'chat-stop-ask', cwd: home });
    manager.attach('chat-stop-ask', 'c1');
    await manager.send('chat-stop-ask', 'background approval: ls\nslow');
    await recorder.until(() => recorder.items.get('approval-req-bg') !== undefined);
    expect(recorder.info?.status).toBe('needs-you');

    manager.cancel('chat-stop-ask');
    await recorder.until(() => recorder.ofKind('turn')[0]?.state === 'aborted');
    expect(recorder.items.get('approval-req-bg')).toMatchObject({ decision: 'cancelled' });
    // The agent heard no, so it finishes instead of waiting on an answer nobody can give any more.
    await recorder.until(() => recorder.ofKind('turn')[1]?.state === 'done' && idle());
    expect(subagentWork().find((item) => item.kind === 'tool')).toMatchObject({ output: 'The user stopped the turn', state: 'error' });
});

test('a background subagent that settles opens a turn of the agent, with the summary as its label', async () => {
    await manager.create({ chatId: 'chat-bg', cwd: home });
    manager.attach('chat-bg', 'c1');
    await manager.send('chat-bg', 'background: report written');
    await recorder.until(idle);
    expect(recorder.ofKind('turn')).toHaveLength(1);

    // Nothing is sent from here, since the CLI wakes the agent itself once the task settles.
    claude.started[0]!.runLater();
    claude.started[0]!.runLater();
    await recorder.until(() => recorder.ofKind('turn').length === 2);
    const agentTurn = recorder.ofKind('turn')[1]!;
    expect(agentTurn).toMatchObject({ origin: 'agent', label: 'report written' });
    expect(recorder.events.some((event) => event.type === 'item' && event.item.id === agentTurn.id && event.item.kind === 'turn')).toBe(true);
    expect(recorder.events.some((event) => event.type === 'info' && event.info.activeTurnId === agentTurn.id && event.info.status === 'running')).toBe(true);

    const settled = (): boolean => {
        const turn = recorder.items.get(agentTurn.id);
        return turn?.kind === 'turn' && turn.state === 'done';
    };
    await recorder.until(settled);
    expect(recorder.items.get(agentTurn.id)).toMatchObject({ state: 'done', endedAt: expect.any(Number) });
    expect(idle()).toBe(true);
    // The person wrote one message; the second turn has none and carries the agent's own answer.
    expect(recorder.ofKind('user')).toHaveLength(1);
    const answers = recorder.ofKind('assistant').filter((item) => !item.parentToolUseId);
    expect(answers.map((item) => item.text)).toEqual(['I will report back', 'the subagent says: report written']);
    expect(answers[1]?.turnId).toBe(agentTurn.id);

    const subagent = recorder.ofKind('subagent')[0]!;
    expect(subagent).toMatchObject({
        toolUseId: 'toolu_agent',
        description: 'report written',
        subagentType: 'general-purpose',
        background: true,
        status: 'done',
        summary: 'report written',
        result: 'the subagent says: report written',
        usage: { totalTokens: 1500, toolUses: 2, durationMs: 250 }
    });
    expect(agentTurn.taskToolUseId).toBe('toolu_agent');
    const children = [...recorder.items.values()].filter((item) => item.kind === 'tool' && item.parentToolUseId === 'toolu_agent');
    expect(children.map((item) => (item.kind === 'tool' ? item.name : ''))).toEqual(['Read', 'Bash']);
    // A subagent's work belongs to the turn its row sits in, not to the turn that woke the agent.
    expect(children.every((item) => item.turnId === subagent.turnId)).toBe(true);
});

test('a foreground subagent settles from its own call, without the footer the CLI appends', async () => {
    await manager.create({ chatId: 'chat-delegate', cwd: home });
    manager.attach('chat-delegate', 'c1');
    await manager.send('chat-delegate', 'delegate: read the readme');
    await recorder.until(idle);

    const subagent = recorder.ofKind('subagent')[0]!;
    expect(subagent).toMatchObject({
        toolUseId: 'toolu_delegate',
        description: 'read the readme',
        subagentType: 'general-purpose',
        prompt: 'Do this: read the readme',
        background: false,
        status: 'done',
        result: '# Report\n\n- one\n- two',
        lastTool: 'Bash',
        usage: { totalTokens: 1500, toolUses: 2, durationMs: 250 },
        itemsTruncated: false
    });
    expect(recorder.ofKind('tool').filter((item) => item.parentToolUseId === 'toolu_delegate')).toHaveLength(2);
    // The delegation is a subagent row, so it is not a tool row as well.
    expect(recorder.ofKind('tool').some((item) => item.name === 'Agent')).toBe(false);
});

test('a subagent whose work arrives before the CLI says it started keeps that work on its own row', async () => {
    await manager.create({ chatId: 'chat-early', cwd: home });
    manager.attach('chat-early', 'c1');
    await manager.send('chat-early', 'delegate late: read the readme');
    await recorder.until(idle);

    expect(recorder.ofKind('subagent')).toHaveLength(1);
    expect(recorder.ofKind('subagent')[0]).toMatchObject({
        toolUseId: 'toolu_delegate',
        status: 'done',
        background: false,
        subagentType: 'general-purpose',
        lastTool: 'Bash',
        result: '# Report\n\n- one\n- two',
        native: { agentId: 'task-delegate' }
    });
    const work = subagentWork();
    expect(work.map((item) => [item.kind, item.parentToolUseId])).toEqual([
        ['tool', 'toolu_delegate'],
        ['tool', 'toolu_delegate'],
        ['assistant', 'toolu_delegate']
    ]);
    // Nothing of the subagent's reached the thread of the chat itself.
    expect(recorder.ofKind('tool').every((item) => item.parentToolUseId === 'toolu_delegate')).toBe(true);
    expect(
        recorder
            .ofKind('assistant')
            .filter((item) => !item.parentToolUseId)
            .map((item) => item.text)
    ).toEqual(['summarized']);
    expect(recorder.ofKind('turn')).toHaveLength(1);
});

test('a background subagent that works on after its turn ended writes on its own row and opens a turn only once it settles', async () => {
    await manager.create({ chatId: 'chat-later', cwd: home });
    manager.attach('chat-later', 'c1');
    await manager.send('chat-later', 'background: report written');
    await recorder.until(idle);
    const launched = recorder.ofKind('turn')[0]!;
    // The person goes on with the chat before the subagent is done.
    await manager.send('chat-later', 'next question');
    await recorder.until(() => idle() && recorder.ofKind('turn').length === 2);

    claude.started[0]!.runLater();
    await recorder.until(() => recorder.ofKind('subagent')[0]?.result === 'the subagent says: report written');
    expect(recorder.ofKind('subagent')[0]).toMatchObject({ status: 'running', turnId: launched.id });
    const work = subagentWork();
    expect(work.map((item) => [item.kind, item.parentToolUseId, item.turnId])).toEqual([
        ['tool', 'toolu_agent', launched.id],
        ['tool', 'toolu_agent', launched.id],
        ['assistant', 'toolu_agent', launched.id]
    ]);
    expect(recorder.ofKind('turn')).toHaveLength(2);
    expect(idle()).toBe(true);
    expect(
        recorder
            .ofKind('assistant')
            .filter((item) => !item.parentToolUseId)
            .map((item) => item.text)
    ).toEqual(['I will report back', 'echo: next question']);

    claude.started[0]!.runLater();
    await recorder.until(() => idle() && recorder.ofKind('turn').length === 3);
    expect(recorder.ofKind('subagent')[0]).toMatchObject({ status: 'done', turnId: launched.id });
    expect(recorder.ofKind('turn')[2]).toMatchObject({ origin: 'agent', label: 'report written', taskToolUseId: 'toolu_agent' });
});

describe('the conversation of a Claude subagent', () => {
    const SESSION = '5f1c2a9e-0b7d-4c1e-9a53-3e2f8d6b7a10';

    test('is read beside the session with no CLI running, notes its agent on the row, and lets go with the socket', async () => {
        await retire(manager);
        const watch = new FakeWatch();
        manager = makeManager({ subagents: { claudeProjectsDir: FIXTURE, seams: watch } });
        manager.subscribe('c1', recorder.sink());
        await manager.create({ chatId: 'chat-sub', cwd: '/work/demo', resume: SESSION });
        manager.attach('chat-sub', 'c1');
        const session = manager.get('chat-sub')!;
        session.thread.upsert({
            id: '1:toolu_01ParentAgentCall',
            kind: 'subagent',
            createdAt: 1,
            turnId: null,
            toolUseId: 'toolu_01ParentAgentCall',
            description: 'Survey the docs',
            subagentType: 'general-purpose',
            prompt: null,
            background: false,
            status: 'done',
            startedAt: 1,
            finishedAt: 2,
            summary: null,
            result: null,
            usage: null,
            lastTool: null,
            itemsTruncated: false
        });

        const page = await manager.subagent('c1', { chatId: 'chat-sub', toolUseId: 'toolu_01ParentAgentCall', watch: true });
        expect(page).toMatchObject({ source: 'claude-transcript', live: false });
        expect(page.items.at(-1)).toMatchObject({ kind: 'assistant' });
        expect(claude.started).toHaveLength(0);
        await recorder.until(() => recorder.ofKind('subagent')[0]?.native?.agentId === 'a4c2e8f10b3d5a7e9');

        const dir = join(FIXTURE, '-work-demo', SESSION, 'subagents');
        const watcher = watch.on(dir);
        watcher.emit('agent-a4c2e8f10b3d5a7e9.jsonl');
        const told: unknown[] = [];
        manager.subscribe('c1', (event) => told.push(event));
        await watch.settle();
        expect(told).toEqual([{ event: 'chat.subagentChanged', payload: { chatId: 'chat-sub', toolUseId: 'toolu_01ParentAgentCall' } }]);

        manager.detachAll('c1');
        expect(watcher.closed).toBe(true);
    });
});

describe('a background subagent whose CLI is gone', () => {
    const SESSION = '5f1c2a9e-0b7d-4c1e-9a53-3e2f8d6b7a10';
    const CALL = 'toolu_01ChildAgentCall';

    const runningRow = (toolUseId: string, id = `1:${toolUseId}`): ChatSubagentItem => ({
        id,
        kind: 'subagent',
        createdAt: 1,
        turnId: 'turn-1',
        toolUseId,
        description: 'Count the headings',
        subagentType: 'general-purpose',
        prompt: null,
        background: true,
        status: 'running',
        startedAt: 1,
        finishedAt: null,
        summary: 'Running grep',
        result: null,
        usage: null,
        lastTool: 'Bash',
        itemsTruncated: false
    });

    const storedInfo = (chatId: string, provider: ChatInfo['provider']): ChatInfo => ({
        chatId,
        provider,
        cwd: '/work/demo',
        agentSessionId: SESSION,
        model: null,
        selection: { model: 'claude-opus-5', options: {} },
        runtimeMode: 'full-access',
        status: 'idle',
        running: false,
        activeTurnId: null,
        slashCommands: [],
        usage: { contextTokens: 0, contextWindow: 200_000, costUsd: 0, turns: 1 },
        createdAt: 1
    });

    const rowOf = (target: ChatManager, chatId: string, toolUseId: string): ChatItem | undefined =>
        target.get(chatId)?.thread.find('subagent', (item) => item.toolUseId === toolUseId);

    let projects: string;

    beforeEach(async () => {
        projects = join(home, 'claude-projects');
        await cp(FIXTURE, projects, { recursive: true });
    });

    test('settles as done on load when its transcript shows the end, which the next load keeps', async () => {
        await store.write('chat-stale', storedInfo('chat-stale', 'claude'), [runningRow(CALL)]);
        await retire(manager);
        manager = makeManager({ subagents: { claudeProjectsDir: projects, seams: new FakeWatch() } });

        await manager.create({ chatId: 'chat-stale' });
        expect(rowOf(manager, 'chat-stale', CALL)).toMatchObject({
            status: 'done',
            finishedAt: Date.parse('2026-09-16T08:58:39.000Z'),
            result: 'There are 42 headings.'
        });
        await manager.shutdown();
        expect((await store.read('chat-stale'))?.items.find((item) => item.kind === 'subagent')).toMatchObject({ status: 'done' });
    });

    test('marks an unfinished transcript lost on load and recovers a later recorded end on read', async () => {
        const transcript = join(projects, '-work-demo', SESSION, 'subagents', 'agent-a9b8c7d6e5f4a3b21.jsonl');
        const finished = await readFile(transcript, 'utf8');
        const lines = finished.trimEnd().split('\n');
        const toolCall = JSON.stringify({
            isSidechain: true,
            type: 'assistant',
            timestamp: '2026-09-16T08:58:31.000Z',
            message: { id: 'msg_more', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_more', name: 'Bash', input: {} }], stop_reason: 'tool_use' }
        });
        await writeFile(transcript, `${[...lines, toolCall].join('\n')}\n`);
        await store.write('chat-working', storedInfo('chat-working', 'claude'), [runningRow(CALL)]);
        await retire(manager);
        manager = makeManager({ subagents: { claudeProjectsDir: projects, seams: new FakeWatch() } });
        manager.subscribe('c1', recorder.sink());

        await manager.create({ chatId: 'chat-working' });
        expect(rowOf(manager, 'chat-working', CALL)).toMatchObject({ status: 'failed', finishedAt: expect.any(Number) });

        const answer = JSON.stringify({
            isSidechain: true,
            type: 'assistant',
            timestamp: '2026-09-16T08:59:00.000Z',
            message: { id: 'msg_last', role: 'assistant', content: [{ type: 'text', text: 'Still 42.' }], stop_reason: 'end_turn' }
        });
        await appendFile(transcript, `${answer}\n`);
        await manager.subagent('c1', { chatId: 'chat-working', toolUseId: CALL });
        expect(rowOf(manager, 'chat-working', CALL)).toMatchObject({ status: 'done', finishedAt: Date.parse('2026-09-16T08:59:00.000Z'), result: 'Still 42.' });
    });

    test('a Codex agent was running inside the app-server that went down, so a load settles it as failed', async () => {
        await store.write('chat-codex', storedInfo('chat-codex', 'codex'), [{ ...runningRow('collab_1'), native: { threadId: 'child-1' } }]);
        await retire(manager);
        manager = makeManager({ subagents: { claudeProjectsDir: projects, seams: new FakeWatch() } });

        await manager.create({ chatId: 'chat-codex' });
        expect(rowOf(manager, 'chat-codex', 'collab_1')).toMatchObject({ status: 'failed', finishedAt: expect.any(Number) });
    });

    test('a CLI that exits before its notification leaves the row done when the transcript shows the end, failed otherwise', async () => {
        const subagents = join(projects, '-work-demo', SESSION, 'subagents');
        await writeFile(join(subagents, 'agent-afake.meta.json'), JSON.stringify({ agentType: 'general-purpose', toolUseId: 'toolu_agent' }));
        await writeFile(
            join(subagents, 'agent-afake.jsonl'),
            `${JSON.stringify({ type: 'assistant', timestamp: '2026-09-16T09:00:00.000Z', message: { id: 'm', role: 'assistant', content: [{ type: 'text', text: 'All written.' }], stop_reason: 'end_turn' } })}\n`
        );
        await retire(manager);
        manager = makeManager({ subagents: { claudeProjectsDir: projects, seams: new FakeWatch() } });
        manager.subscribe('c1', recorder.sink());
        await manager.create({ chatId: 'chat-exit', cwd: '/work/demo', resume: SESSION });
        manager.attach('chat-exit', 'c1');
        await manager.send('chat-exit', 'background: report written');
        await recorder.until(idle);
        expect(rowOf(manager, 'chat-exit', 'toolu_agent')).toMatchObject({ status: 'running' });

        // The CLI goes before the work it put off ever runs, so no notification comes.
        void manager.send('chat-exit', 'crash').catch(() => undefined);
        await claude.started[0]!.exited;
        await recorder.until(() => recorder.ofKind('subagent')[0]?.status === 'done');
        expect(rowOf(manager, 'chat-exit', 'toolu_agent')).toMatchObject({
            status: 'done',
            result: 'All written.',
            finishedAt: Date.parse('2026-09-16T09:00:00.000Z')
        });
    });
});

describe("stopping a subagent of the CLI's own", () => {
    test('is refused while the turn that may wait on it runs, and marks the row stopped with a note once none runs', async () => {
        await manager.create({ chatId: 'chat-stop', cwd: home });
        manager.attach('chat-stop', 'c1');
        const session = manager.get('chat-stop')!;
        session.thread.upsert({
            id: '1:toolu_bg',
            kind: 'subagent',
            createdAt: 1,
            turnId: null,
            toolUseId: 'toolu_bg',
            description: 'Review the branch',
            subagentType: 'general-purpose',
            prompt: null,
            background: true,
            status: 'running',
            startedAt: 1,
            finishedAt: null,
            summary: null,
            result: null,
            usage: null,
            lastTool: null,
            itemsTruncated: false
        });

        void manager.send('chat-stop', 'slow');
        await recorder.until(() => recorder.info?.activeTurnId !== null);
        await expect(manager.stopSubagent('chat-stop', 'toolu_bg')).rejects.toMatchObject({ code: 'chat-busy' });
        manager.cancel('chat-stop');
        await recorder.until(() => recorder.info?.activeTurnId === null);

        await manager.stopSubagent('chat-stop', 'toolu_bg');
        expect(recorder.items.get('1:toolu_bg')).toMatchObject({ status: 'failed', finishedAt: expect.any(Number) });
        expect(recorder.ofKind('note').map((note) => note.text)).toContain(
            '"Review the branch" was marked as stopped. Claude Code cannot stop one sub-agent on its own, so it may keep working until the chat\'s process ends.'
        );
        await manager.stopSubagent('chat-stop', 'toolu_bg');
        await expect(manager.stopSubagent('chat-stop', 'toolu_none')).rejects.toMatchObject({ code: 'subagent-not-found' });
    });
});
