import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import type { ContextSource } from '@ruimte/contracts';
import { chatPrompt, verbsNote } from '../context/context-note.ts';
import { showNotices, NoticeNotes, unshownNotes, NoticeStore, type Notice } from '@adecore/agents/coordination';
import { deliverNotice, MESSAGE_WORDS } from '../context/notices.ts';
import { VisualStore } from '@adecore/agents/chat';
import { chatReferenceNote } from '../context/chat-references.ts';
import { ChatManager } from './chat-manager.ts';
import { ChatRecorder } from './chat-test-helpers.ts';
import { makeChatFixture, retire, LINKED } from './chat-manager.fixture.test.ts';

type ChatFixture = Awaited<ReturnType<typeof makeChatFixture>>;
let home: ChatFixture['home'];
let attachments: ChatFixture['attachments'];
let store: ChatFixture['store'];
let claude: ChatFixture['claude'];
let manager: ChatFixture['manager'];
let recorder: ChatFixture['recorder'];
let makeManager: ChatFixture['makeManager'];
function idle() {
    return recorder.info?.status === 'idle' && recorder.info.running && recorder.info.activeTurnId === null;
}
beforeEach(async () => {
    ({ home, attachments, store, claude, manager, recorder, makeManager } = await makeChatFixture());
});
afterEach(async () => {
    await retire(manager);
    await rm(home, { recursive: true, force: true });
});

test('a standalone chat passes its location to the Claude system prompt', async () => {
    await retire(manager);
    manager = makeManager({ standalone: (id) => id === 'chat-view' });
    manager.subscribe('c1', recorder.sink());
    await manager.create({ chatId: 'chat-view', cwd: home });
    manager.attach('chat-view', 'c1');
    await manager.send('chat-view', 'system?');
    await recorder.until(idle);
    expect(recorder.ofKind('assistant')[0]?.text).toBe(verbsNote({ depth: 0, standalone: true }));
});

test('the system prompt names visuals while the machine has them on, and never to an inline edit', async () => {
    await retire(manager);
    const visuals = new VisualStore(home, attachments);
    manager = makeManager({ visuals, visualReplies: () => true, inlineChat: (chatId) => chatId === 'chat-inline' });
    manager.subscribe('c1', recorder.sink());
    await manager.create({ chatId: 'chat-shows', cwd: home });
    manager.attach('chat-shows', 'c1');
    await manager.send('chat-shows', 'system?');
    await recorder.until(idle);
    expect(recorder.ofKind('assistant')[0]?.text).toBe(verbsNote({ depth: 0, visuals: true }));
    expect(claude.started[0]!.argv.filter((arg) => arg.startsWith('--add-dir='))).toEqual([`--add-dir=${visuals.workspacePath('chat-shows')}`]);

    const inline = new ChatRecorder();
    manager.subscribe('c2', inline.sink());
    await manager.create({ chatId: 'chat-inline', cwd: home });
    manager.attach('chat-inline', 'c2');
    // The first prompt carries the inline edit's preamble, which the fake echoes instead.
    await manager.send('chat-inline', 'first');
    await inline.until(() => inline.ofKind('assistant').length === 1 && inline.info?.activeTurnId === null);
    await manager.send('chat-inline', 'system?');
    await inline.until(() => inline.ofKind('assistant').length === 2 && inline.info?.activeTurnId === null);
    expect(inline.ofKind('assistant')[1]?.text).toBe(verbsNote({ depth: 0 }));
    expect(claude.started[1]!.argv.some((arg) => arg.startsWith('--add-dir='))).toBe(false);
});

test('the system prompt names the verbs always and the linked sources by name when there are some', async () => {
    await manager.create({ chatId: 'chat-sys', cwd: home });
    manager.attach('chat-sys', 'c1');
    await manager.send('chat-sys', 'system?');
    await recorder.until(idle);
    expect(recorder.ofKind('assistant')[0]?.text).toBe(verbsNote({ depth: 0 }));

    await retire(manager);
    manager = makeManager({ contextSources: () => LINKED, depthOf: () => 2 });
    const linked = new ChatRecorder();
    manager.subscribe('c2', linked.sink());
    await manager.create({ chatId: 'chat-sys-2', cwd: home });
    manager.attach('chat-sys-2', 'c2');
    await manager.send('chat-sys-2', 'system?');
    await linked.until(() => linked.ofKind('assistant').length === 1 && linked.info?.activeTurnId === null);
    // The same sentence a Codex thread is started with, asserted there against the same call.
    expect(linked.ofKind('assistant')[0]?.text).toBe(chatPrompt({ sources: LINKED, depth: 2 }));
    expect(linked.ofKind('assistant')[0]?.text).toContain('"iPhone 18 Pro Max" (device)');
});

test('a link made between turns is put in front of the next prompt, once, as a note', async () => {
    let sources: ContextSource[] = [];
    await retire(manager);
    manager = makeManager({ contextSources: () => sources });
    manager.subscribe('c1', recorder.sink());
    await manager.create({ chatId: 'chat-ctx', cwd: home });
    manager.attach('chat-ctx', 'c1');

    await manager.send('chat-ctx', 'first');
    await recorder.until(idle);
    sources = [{ id: 'term-1', kind: 'terminal', title: 'dev server' }];
    await manager.send('chat-ctx', 'second');
    await recorder.until(() => recorder.info?.usage.turns === 2 && idle());
    await manager.send('chat-ctx', 'third');
    await recorder.until(() => recorder.info?.usage.turns === 3 && idle());

    const notes = recorder.ofKind('note');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ level: 'info', turnId: recorder.ofKind('turn')[1]?.turnId });
    expect(notes[0]?.text).toContain('Added: "dev server" (terminal)');
    // The fake echoes its prompt, so the reply shows what the CLI was given.
    const replies = recorder.ofKind('assistant').map((item) => item.text);
    expect(replies[0]).toBe('echo: first');
    expect(replies[1]).toBe(`echo: ${notes[0]?.text}\n\nsecond`);
    expect(replies[2]).toBe('echo: third');
    expect(recorder.ofKind('user').map((item) => item.text)).toEqual(['first', 'second', 'third']);
});

test('a chat attached with @ goes to the CLI as the command that reads it, and to the thread as its id', async () => {
    await retire(manager);
    const titles: Record<string, string> = { 'chat-earlier': 'Auth rewrite' };
    manager = makeManager({ chatTitle: (chatId, id) => (chatId === 'chat-ref' ? (titles[id] ?? null) : null) });
    manager.subscribe('c1', recorder.sink());
    await manager.create({ chatId: 'chat-ref', cwd: home });
    manager.attach('chat-ref', 'c1');

    await manager.send('chat-ref', 'carry on from there', { chats: ['chat-earlier', 'chat-elsewhere'] });
    await recorder.until(idle);

    expect(recorder.ofKind('user')[0]).toMatchObject({ text: 'carry on from there', chats: ['chat-earlier'] });
    // The fake echoes its prompt, so the reply shows what the CLI was given.
    expect(recorder.ofKind('assistant')[0]?.text).toBe(`echo: ${chatReferenceNote([{ id: 'chat-earlier', title: 'Auth rewrite' }])}\n\ncarry on from there`);
    // Nothing in the thread repeats it: the row draws the chip.
    expect(recorder.ofKind('note')).toEqual([]);
});

describe('the first prompt of an agent node', () => {
    const withPrompt = (prompt: string | null) => {
        let left = prompt;
        const taken = () =>
            makeManager({
                firstPrompt: async () => {
                    const value = left;
                    left = null;
                    return value;
                }
            });
        return { taken, left: () => left };
    };

    const settledIn = (chatId: string) => (): boolean => manager.get(chatId)?.info.activeTurnId === null && manager.get(chatId)?.info.running === true;

    const threadOf = (chatId: string) => manager.get(chatId)!.thread.list();

    test('becomes the first message of the thread, so the person reads it as one', async () => {
        const held = withPrompt('start on the parser');
        await retire(manager);
        manager = held.taken();
        manager.subscribe('c1', recorder.sink());

        const info = await manager.create({ chatId: 'chat-p', cwd: home });
        // The prompt is in the thread before create answers, so an attach right after it shows the turn.
        const items = manager.attach('chat-p', 'c1').items;
        expect(items.filter((item) => item.kind === 'user').map((item) => item.kind === 'user' && item.text)).toEqual(['start on the parser']);
        expect(info.chatId).toBe('chat-p');
        await recorder.until(settledIn('chat-p'));
        expect(
            threadOf('chat-p')
                .filter((item) => item.kind === 'assistant')
                .map((item) => item.kind === 'assistant' && item.text)
        ).toEqual(['echo: start on the parser']);
        expect(held.left()).toBeNull();
    });

    test('a second create of the same chat sends nothing again', async () => {
        const held = withPrompt('only once');
        await retire(manager);
        manager = held.taken();
        manager.subscribe('c1', recorder.sink());

        const userTexts = () =>
            threadOf('chat-p')
                .filter((item) => item.kind === 'user')
                .map((item) => item.text);
        await manager.create({ chatId: 'chat-p', cwd: home });
        manager.attach('chat-p', 'c1');
        await recorder.until(settledIn('chat-p'));
        expect(userTexts()).toEqual(['only once']);

        // The client of a second window mounts the same node; the prompt is gone, so nothing is sent.
        await manager.create({ chatId: 'chat-p', cwd: home });
        expect(userTexts()).toEqual(['only once']);
        expect(held.left()).toBeNull();
        expect(claude.started).toHaveLength(1);
    });

    test('two creates at once, the machine starting the node and a client mounting it, send it once to one chat', async () => {
        const held = withPrompt('only once');
        await retire(manager);
        manager = held.taken();
        manager.subscribe('c1', recorder.sink());

        const [started, mounted] = await Promise.all([manager.create({ chatId: 'chat-r', cwd: home }), manager.create({ chatId: 'chat-r', cwd: home })]);
        expect(mounted).toBe(started);
        // The mount waited for the whole create, so what it attaches to already carries the prompt.
        expect(
            manager
                .attach('chat-r', 'c1')
                .items.filter((item) => item.kind === 'user')
                .map((item) => item.kind === 'user' && item.text)
        ).toEqual(['only once']);
        await recorder.until(settledIn('chat-r'));
        expect(claude.started).toHaveLength(1);
    });

    test('a kill that arrives while the chat is being made ends the chat that was made', async () => {
        await retire(manager);
        manager = withPrompt('go').taken();
        const creating = manager.create({ chatId: 'chat-s', cwd: home });
        const killed = manager.kill('chat-s');
        await creating;
        await killed;
        expect(manager.get('chat-s')).toBeUndefined();
    });

    test('without a prompt, create still spawns nothing', async () => {
        await retire(manager);
        manager = withPrompt(null).taken();
        manager.subscribe('c1', recorder.sink());
        await manager.create({ chatId: 'chat-q', cwd: home });
        expect(manager.get('chat-q')?.running).toBe(false);
        expect(claude.started).toHaveLength(0);
    });
});

describe('a message another node left', () => {
    let notices: NoticeStore;

    const withNotices = (): ChatManager =>
        makeManager({
            messageNotes: (chatId) => new NoticeNotes(notices, chatId, MESSAGE_WORDS),
            unshownMessages: (chatId) => unshownNotes(notices, chatId, MESSAGE_WORDS)
        });

    const notify = async (targetId: string, text: string): Promise<void> => {
        const notice: Omit<Notice, 'createdAt'> = { projectId: 'project-1', targetId, from: 'term-1', fromTitle: 'dev server', text };
        await deliverNotice(
            notices,
            {
                terminal: () => null,
                // No outbox in these tests, so the message waits for the turn the test sends itself.
                chat: async (id) => (manager.get(id) === undefined ? 'none' : 'running'),
                fromMessage: () => false
            },
            notice
        );
        await showNotices(notices, { has: (id) => manager.hasStored(id), note: (id, line) => manager.addNote(id, 'info', line) }, MESSAGE_WORDS, targetId);
    };

    const heard = 'Ruimte: node term-1 ("dev server") sent you a message: the build is green';
    const read = 'dev server sent a message: the build is green';

    beforeEach(async () => {
        await retire(manager);
        notices = new NoticeStore(home);
        manager = withNotices();
        recorder = new ChatRecorder();
        manager.subscribe('c1', recorder.sink());
    });

    test('lands in the thread of a running chat at once, and in front of its next prompt once', async () => {
        await manager.create({ chatId: 'chat-msg', cwd: home });
        manager.attach('chat-msg', 'c1');
        await manager.send('chat-msg', 'first');
        await recorder.until(idle);

        await notify('chat-msg', 'the build is green');
        await recorder.until(() => recorder.ofKind('note').length === 1);
        // Outside any turn, since nothing the model did put it there.
        expect(recorder.ofKind('note')[0]).toMatchObject({ level: 'info', turnId: null, text: read });

        await manager.send('chat-msg', 'second');
        await recorder.until(() => recorder.info?.usage.turns === 2 && idle());
        await manager.send('chat-msg', 'third');
        await recorder.until(() => recorder.info?.usage.turns === 3 && idle());

        expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['echo: first', `echo: ${heard}\n\nsecond`, 'echo: third']);
        /* One line for a person, written when the message landed. The turn that carried it to the
           model adds none of its own, since its preamble only repeats what the thread already says. */
        expect(recorder.ofKind('note')).toHaveLength(1);
    });

    test('waits for a chat nobody has started, and is in the thread before its first prompt', async () => {
        await notify('chat-cold', 'the build is green');
        // Nothing holds that id yet, so nothing was shown and nothing was taken.
        expect(notices.waiting('chat-cold')).toHaveLength(1);

        await manager.create({ chatId: 'chat-cold', cwd: home });
        expect(manager.attach('chat-cold', 'c1').items).toEqual([expect.objectContaining({ kind: 'note', level: 'info', turnId: null, text: read })]);

        await manager.send('chat-cold', 'what happened');
        await recorder.until(idle);
        expect(recorder.ofKind('assistant')[0]?.text).toBe(`echo: ${heard}\n\nwhat happened`);
    });

    test('is in the thread once after a restart, whether or not the model heard it yet', async () => {
        await manager.create({ chatId: 'chat-again', cwd: home });
        manager.attach('chat-again', 'c1');
        await notify('chat-again', 'the build is green');
        await store.written('chat-again', (record) => record.items.some((item) => item.kind === 'note'));

        await retire(manager);
        notices = new NoticeStore(home);
        await notices.load();
        manager = withNotices();
        recorder = new ChatRecorder();
        manager.subscribe('c1', recorder.sink());

        await manager.create({ chatId: 'chat-again', cwd: home });
        expect(manager.attach('chat-again', 'c1').items.filter((item) => item.kind === 'note')).toEqual([expect.objectContaining({ text: read })]);
        // And the model, which had not heard it when the daemon went down, still hears it exactly once.
        await manager.send('chat-again', 'what happened');
        await recorder.until(idle);
        expect(recorder.ofKind('assistant')[0]?.text).toBe(`echo: ${heard}\n\nwhat happened`);
    });
});
