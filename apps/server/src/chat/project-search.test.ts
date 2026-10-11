import { describe, expect, test } from 'bun:test';
import type { ChatItem, ProjectView } from '@ruimte/contracts';
import { chatsOfViews, ProjectChatSearch, type ProjectChatSearchDeps } from './project-search.ts';

const message = (id: string, text: string, kind: 'user' | 'assistant' = 'user'): ChatItem =>
    kind === 'user' ? { id, kind, createdAt: 1, turnId: null, text } : { id, kind, createdAt: 1, turnId: null, text, streaming: false };

function setup(overrides: Partial<ProjectChatSearchDeps> = {}) {
    const stored: Record<string, ChatItem[] | Error> = {
        a: [message('a1', 'the cache is warm')],
        b: [message('b1', 'nothing here'), message('b2', 'a CACHE miss', 'assistant')]
    };
    const deps: ProjectChatSearchDeps = {
        holds: async (clientId, projectId) => clientId === 'client' && projectId === 'p1',
        chatsOf: (projectId) =>
            projectId === 'p1'
                ? [
                      { chatId: 'a', title: 'Alpha' },
                      { chatId: 'b', title: 'Beta' }
                  ]
                : [{ chatId: 'z', title: 'Other project' }],
        loadedItems: () => null,
        readStored: async (chatId) => {
            const record = stored[chatId];
            if (record instanceof Error) {
                throw record;
            }
            return record ?? null;
        },
        ...overrides
    };
    return { search: new ProjectChatSearch(deps), stored };
}

const query = { projectId: 'p1', query: 'cache', searchId: 's1' };

describe('searching the chats of a project', () => {
    test('groups the hits per chat, with the titles', async () => {
        const result = await setup().search.search(query, 'client');
        expect(result.hits.map((hit) => [hit.chatId, hit.itemId, hit.author])).toEqual([
            ['a', 'a1', 'person'],
            ['b', 'b2', 'agent']
        ]);
        expect(result.chats).toEqual([
            { chatId: 'a', title: 'Alpha' },
            { chatId: 'b', title: 'Beta' }
        ]);
        expect(result).toMatchObject({ searched: 2, failed: [], truncated: false, cancelled: false });
    });

    test('reads the text the log gave a stored chat, which is what the fake store returns', async () => {
        const { search, stored } = setup();
        stored.a = [message('a1', 'the log rewrote this to say cache')];
        const result = await search.search(query, 'client');
        expect(result.hits[0]).toMatchObject({ chatId: 'a', itemId: 'a1', snippet: 'the log rewrote this to say cache' });
    });

    test('prefers the thread a session holds over the one on disk', async () => {
        const { search } = setup({ loadedItems: (chatId) => (chatId === 'a' ? [message('live', 'live cache')] : null) });
        const result = await search.search(query, 'client');
        expect(result.hits.map((hit) => hit.itemId)).toEqual(['live', 'b2']);
    });

    test('an unreadable chat is reported and the others still searched', async () => {
        const { search, stored } = setup();
        stored.a = new Error('corrupt');
        const result = await search.search(query, 'client');
        expect(result.failed).toEqual([{ chatId: 'a', title: 'Alpha', reason: expect.any(String) }]);
        expect(result.hits.map((hit) => hit.chatId)).toEqual(['b']);
        expect(result.searched).toBe(1);
    });

    test('a cancel between two chats stops the search with what it has', async () => {
        const gate = Promise.withResolvers<readonly ChatItem[] | null>();
        let reads = 0;
        const { search } = setup({
            readStored: (chatId) => {
                reads += 1;
                return chatId === 'a' ? gate.promise : Promise.resolve([message('b2', 'cache')]);
            }
        });
        const pending = search.search(query, 'client');
        await Promise.resolve();
        await Promise.resolve();
        search.cancel('s1', 'client');
        gate.resolve([message('a1', 'cache')]);
        const result = await pending;
        expect(result.cancelled).toBe(true);
        expect(result.hits.map((hit) => hit.itemId)).toEqual(['a1']);
        expect(reads).toBe(1);
    });

    test('a cancel from another client leaves the search alone, whatever id it picked', async () => {
        const gate = Promise.withResolvers<readonly ChatItem[] | null>();
        const { search } = setup({
            holds: async () => true,
            readStored: (chatId) => (chatId === 'a' ? gate.promise : Promise.resolve([message('b2', 'cache')]))
        });
        const pending = search.search(query, 'client');
        await Promise.resolve();
        await Promise.resolve();
        search.cancel('s1', 'other');
        gate.resolve([message('a1', 'cache')]);
        const result = await pending;
        expect(result.cancelled).toBe(false);
        expect(result.hits.map((hit) => hit.itemId)).toEqual(['a1', 'b2']);
    });

    test('a search that ends does not clear the running mark of another client with the same id', async () => {
        const gate = Promise.withResolvers<readonly ChatItem[] | null>();
        const { search } = setup({
            holds: async () => true,
            readStored: (chatId) => (chatId === 'a' ? gate.promise : Promise.resolve([message('b2', 'cache')]))
        });
        const pending = search.search(query, 'client');
        await Promise.resolve();
        await Promise.resolve();
        await search.search({ ...query, query: 'nothing here', projectId: 'p2' }, 'other').catch(() => undefined);
        search.cancel('s1', 'client');
        gate.resolve([message('a1', 'cache')]);
        expect((await pending).cancelled).toBe(true);
    });

    test('a client that does not hold the project is refused', async () => {
        await expect(setup().search.search(query, 'stranger')).rejects.toMatchObject({ code: 'not-open' });
    });

    test('a chat of another project never appears', async () => {
        const result = await setup().search.search(query, 'client');
        expect(result.chats.map((chat) => chat.chatId)).not.toContain('z');
    });

    test('stops at the limit and says so', async () => {
        const { search } = setup();
        const result = await search.search({ ...query, limit: 1 }, 'client');
        expect(result.hits).toHaveLength(1);
        expect(result.truncated).toBe(true);
    });
});

describe('the chats of a project', () => {
    test('are the listed chat views and the chat nodes of canvases', () => {
        const node = { cwd: '/x' };
        const views = [
            { kind: 'chat', id: 'listed', name: 'Listed', node },
            { kind: 'chat', id: 'empty', name: 'Empty', empty: true, node },
            { kind: 'chat', id: 'inline', name: 'Inline', hidden: true, node },
            { kind: 'terminal', id: 'shell', name: 'Shell', node },
            {
                kind: 'canvas',
                id: 'main',
                name: 'Main',
                nodes: [
                    { id: 'agent', kind: 'chat', title: 'Agent' },
                    { id: 'sh', kind: 'terminal', title: 'Sh' }
                ],
                edges: []
            }
        ] as unknown as ProjectView[];
        expect(chatsOfViews(views)).toEqual([
            { chatId: 'listed', title: 'Listed' },
            { chatId: 'agent', title: 'Agent' }
        ]);
    });
});
