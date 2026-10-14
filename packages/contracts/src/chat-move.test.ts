import { describe, expect, test } from 'bun:test';
import { ChatMoveInfoPayloadSchema, ChatMoveInfoResultSchema, ChatMovePayloadSchema, REQUEST_SCHEMAS } from './index.ts';

describe('chat.move', () => {
    test('takes a registered project as its target', () => {
        const parsed = ChatMovePayloadSchema.safeParse({ chatId: 'chat-1', to: { projectId: 'proj-1' }, ownFiles: 'leave' });
        expect(parsed.success).toBe(true);
    });

    test('takes a folder to open as its target', () => {
        const parsed = ChatMovePayloadSchema.safeParse({
            chatId: 'chat-1',
            to: { folder: '/work/vinyl-shelf', name: 'Vinyl shelf', createFolder: true, initGit: false },
            ownFiles: 'move'
        });
        expect(parsed.success).toBe(true);
    });

    test('refuses a way of taking the own files that it does not know', () => {
        const parsed = ChatMovePayloadSchema.safeParse({ chatId: 'chat-1', to: { projectId: 'proj-1' }, ownFiles: 'copy' });
        expect(parsed.success).toBe(false);
    });

    test('refuses a folder target that leaves out a choice', () => {
        const parsed = ChatMovePayloadSchema.safeParse({ chatId: 'chat-1', to: { folder: '/work/a', name: 'A' }, ownFiles: 'move' });
        expect(parsed.success).toBe(false);
    });
});

describe('chat.moveInfo', () => {
    test('asks with or without a target', () => {
        expect(ChatMoveInfoPayloadSchema.safeParse({ chatId: 'chat-1' }).success).toBe(true);
        expect(ChatMoveInfoPayloadSchema.safeParse({ chatId: 'chat-1', to: { projectId: 'proj-1' } }).success).toBe(true);
    });

    test('answers with a refusal that may carry a moment', () => {
        const result = {
            folders: [{ path: '/work/a', project: { projectId: 'proj-1', name: 'A' }, branch: 'main', files: 3 }],
            ownFiles: { folder: '/home/scratch/chat-1', count: 1, names: ['notes.md'] },
            conflicts: [],
            references: 0,
            newFolderParent: '/work',
            refusal: { reason: 'owed', at: 1_700_000_000_000 }
        };
        expect(ChatMoveInfoResultSchema.safeParse(result).success).toBe(true);
        expect(ChatMoveInfoResultSchema.safeParse({ ...result, refusal: { reason: 'sleeping' } }).success).toBe(false);
    });

    test('is on the request table next to chat.move', () => {
        expect(REQUEST_SCHEMAS['chat.move']).toBeDefined();
        expect(REQUEST_SCHEMAS['chat.moveInfo']).toBeDefined();
    });
});
