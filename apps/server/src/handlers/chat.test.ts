import { describe, expect, test } from 'bun:test';
import type { ServerFrame } from '@ruimte/contracts';
import { Dispatcher } from '../dispatcher.ts';
import { askOnce } from './test-helpers.ts';
import type { ChatManager } from '../chat/chat-manager.ts';
import type { ProviderRegistry } from '../providers/registry.ts';
import { registerChatHandlers } from './chat.ts';

function register(started: string[]): Dispatcher {
    const dispatcher = new Dispatcher();
    const manager = {
        create: async (payload: { chatId: string }) => {
            started.push(payload.chatId);
            return { chatId: payload.chatId };
        },
        attachWithBookmarks: async (chatId: string) => {
            started.push(chatId);
            return { chatId };
        }
    } as unknown as ChatManager;
    registerChatHandlers(dispatcher, manager, {} as ProviderRegistry, undefined, undefined, undefined, undefined, undefined, (nodeId) =>
        nodeId === 'remote' ? 'machine-b' : null
    );
    return dispatcher;
}

function ask(dispatcher: Dispatcher, type: string, payload: unknown): Promise<ServerFrame> {
    return askOnce(dispatcher, { id: 'client' }, type, payload);
}

describe('a chat that runs on another machine', () => {
    test('is neither created nor attached here', async () => {
        const started: string[] = [];
        const dispatcher = register(started);
        expect(await ask(dispatcher, 'chat.create', { chatId: 'remote' })).toMatchObject({ ok: false, error: { code: 'node-on-other-machine' } });
        expect(await ask(dispatcher, 'chat.attach', { chatId: 'remote' })).toMatchObject({ ok: false, error: { code: 'node-on-other-machine' } });
        expect(started).toEqual([]);
    });

    test('leaves every other chat alone', async () => {
        const started: string[] = [];
        const dispatcher = register(started);
        expect(await ask(dispatcher, 'chat.create', { chatId: 'local' })).toMatchObject({ ok: true });
        expect(await ask(dispatcher, 'chat.attach', { chatId: 'local' })).toMatchObject({ ok: true });
        expect(started).toEqual(['local', 'local']);
    });
});
