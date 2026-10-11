import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import type { ChatBookmark } from '@ruimte/contracts';
import type { SessionEvent } from '../sessions/manager.ts';
import { BookmarkStore } from '@adecore/agents/chat/bookmark-store';
import { ChatManager } from './chat-manager.ts';
import { INLINE_EDIT_PREAMBLE } from './inline-edit.ts';
import { ChatRecorder } from './chat-test-helpers.ts';
import { makeChatFixture, retire } from './chat-manager.fixture.test.ts';

type ChatFixture = Awaited<ReturnType<typeof makeChatFixture>>;
let home: ChatFixture['home'];
let store: ChatFixture['store'];
let manager: ChatFixture['manager'];
let recorder: ChatFixture['recorder'];
let makeManager: ChatFixture['makeManager'];
function idle() {
    return recorder.info?.status === 'idle' && recorder.info.running && recorder.info.activeTurnId === null;
}
beforeEach(async () => {
    ({ home, store, manager, recorder, makeManager } = await makeChatFixture());
});
afterEach(async () => {
    await retire(manager);
    await rm(home, { recursive: true, force: true });
});

test('a UI block reads and links only for a client that holds the chat project', async () => {
    const holders = new Set<string>();
    await retire(manager);
    manager = makeManager({ holdsProject: async (_chatId, clientId) => holders.has(clientId) });
    await manager.create({ chatId: 'ui-gate', cwd: home });
    manager.attach('ui-gate', 'c1');
    const query = { chatId: 'ui-gate', itemId: 'reply', blockId: 'block', revision: '1', query: 'status' };
    const link = { chatId: 'ui-gate', itemId: 'reply', blockId: 'block', revision: '1', nodeId: 'node' };
    await expect(manager.queryUi(query, 'c1')).rejects.toThrow("Open this chat's project");
    await expect(manager.linkUi(link, 'c1')).rejects.toThrow("Open this chat's project");
    holders.add('c1');
    // Past the gate, the chat core answers: this manager has no UI sources at all.
    await expect(manager.queryUi(query, 'c1')).rejects.toThrow('does not provide UI query sources');
});

test('a reply compiles UI blocks under the ruimte-ui fence that stored chats and agents use', async () => {
    await manager.create({ chatId: 'ui-chat', cwd: home });
    manager.attach('ui-chat', 'c1');
    await manager.send('ui-chat', 'Status\n```ruimte-ui\n<Summary>Ready</Summary>\n```');
    await recorder.until(idle);
    const [reply] = recorder.ofKind('assistant');
    expect(reply?.ui).toHaveLength(1);
    expect(reply?.ui?.[0]?.complete).toBe(true);
});

describe('a chat an inline edit runs in', () => {
    const inline = (): ChatManager => makeManager({ inlineChat: (chatId) => chatId === 'chat-inline' });

    beforeEach(async () => {
        await retire(manager);
        manager = inline();
        recorder = new ChatRecorder();
        manager.subscribe('c1', recorder.sink());
    });

    test('hears the answer format once in front of its first prompt, and none of it shows in the thread', async () => {
        await manager.create({ chatId: 'chat-inline', cwd: home });
        manager.attach('chat-inline', 'c1');
        await manager.send('chat-inline', 'make it shorter');
        await recorder.until(idle);
        await manager.send('chat-inline', 'and rename it');
        await recorder.until(() => recorder.info?.usage.turns === 2 && idle());

        expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual([`echo: ${INLINE_EDIT_PREAMBLE}\n\nmake it shorter`, 'echo: and rename it']);
        expect(recorder.ofKind('user').map((item) => item.text)).toEqual(['make it shorter', 'and rename it']);
        expect(recorder.ofKind('note')).toEqual([]);
    });

    test('says so again after the chat started over', async () => {
        await manager.create({ chatId: 'chat-inline', cwd: home });
        manager.attach('chat-inline', 'c1');
        await manager.send('chat-inline', 'first');
        await recorder.until(idle);
        await manager.clear('chat-inline');
        await manager.send('chat-inline', 'second');
        await recorder.until(() => recorder.ofKind('assistant').some((item) => item.text.endsWith('second')));

        expect(recorder.ofKind('assistant').at(-1)?.text).toBe(`echo: ${INLINE_EDIT_PREAMBLE}\n\nsecond`);
    });

    test('is hidden in the list and no other chat is', async () => {
        const hidden = await manager.create({ chatId: 'chat-inline', cwd: home });
        const listed = await manager.create({ chatId: 'chat-plain', cwd: home });

        expect(hidden.hidden).toBe(true);
        expect(listed.hidden).toBeUndefined();
        expect(manager.list().map((info) => [info.chatId, info.hidden])).toEqual([
            ['chat-inline', true],
            ['chat-plain', undefined]
        ]);
    });

    test('is listed like any chat once its view is, and the record forgets it was hidden', async () => {
        await manager.create({ chatId: 'chat-inline', cwd: home });
        manager.attach('chat-inline', 'c1');
        await manager.send('chat-inline', 'first');
        await recorder.until(idle);
        await store.written('chat-inline', (record) => record.info.hidden === true);

        await retire(manager);
        manager = makeManager();
        const info = await manager.create({ chatId: 'chat-inline', cwd: home });

        expect(info.hidden).toBeUndefined();
    });
});

describe('bookmarks', () => {
    test('a bookmark goes to every client reading the chat, rides on the next attach and goes with a clear', async () => {
        await retire(manager);
        manager = makeManager({ bookmarks: new BookmarkStore(home) });
        manager.subscribe('c1', recorder.sink());
        const heard: Array<{ clientId: string; bookmarks: ChatBookmark[] }> = [];
        for (const clientId of ['c2', 'c3']) {
            manager.subscribe(clientId, (event: SessionEvent) => {
                if (event.event === 'chat.bookmarks') {
                    heard.push({ clientId, bookmarks: event.payload.bookmarks });
                }
            });
        }
        await manager.create({ chatId: 'chat-b', cwd: home });
        manager.attach('chat-b', 'c1');
        await manager.send('chat-b', 'hello  there');
        await recorder.until(idle);
        manager.attach('chat-b', 'c2');

        const reply = recorder.ofKind('assistant')[0]!;
        const list = await manager.addBookmark('chat-b', reply.id, 'The answer');
        expect(list).toEqual([{ itemId: reply.id, name: 'The answer', excerpt: 'echo: hello there', createdAt: expect.any(Number) }]);
        // A client that is not reading the thread hears nothing and gets the list when it attaches.
        expect(heard).toEqual([{ clientId: 'c2', bookmarks: list }]);
        expect((await manager.attachWithBookmarks('chat-b', 'c3')).bookmarks).toEqual(list);

        const turn = recorder.ofKind('turn')[0]!;
        expect(() => manager.addBookmark('chat-b', turn.id)).toThrow('no message');

        await manager.clear('chat-b');
        expect(heard.slice(1)).toEqual([
            { clientId: 'c2', bookmarks: [] },
            { clientId: 'c3', bookmarks: [] }
        ]);
        expect((await manager.attachWithBookmarks('chat-b', 'c3')).bookmarks).toEqual([]);
    });
});
