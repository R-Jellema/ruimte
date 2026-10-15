import { describe, expect, test } from 'bun:test';
import { chatIsWorking, ChatMoveInfoPayloadSchema, ChatMoveInfoResultSchema, ChatMovePayloadSchema, REQUEST_SCHEMAS } from './index.ts';

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

    test('refuses a folder that is not an absolute path', () => {
        for (const folder of ['vinyl', '../vinyl', './vinyl', '~/vinyl']) {
            const to = { folder, name: 'Vinyl', createFolder: true, initGit: false };
            expect(ChatMovePayloadSchema.safeParse({ chatId: 'chat-1', to, ownFiles: 'move' }).success).toBe(false);
            expect(ChatMoveInfoPayloadSchema.safeParse({ chatId: 'chat-1', to }).success).toBe(false);
        }
        const windows = { folder: 'C:\\work\\vinyl', name: 'Vinyl', createFolder: true, initGit: false };
        expect(ChatMovePayloadSchema.safeParse({ chatId: 'chat-1', to: windows, ownFiles: 'move' }).success).toBe(true);
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

describe('chatIsWorking', () => {
    const quiet = { status: 'idle' as const };

    test('reads a quiet chat, and one nobody loaded, as not working', () => {
        expect(chatIsWorking(quiet)).toBe(false);
        expect(chatIsWorking({ ...quiet, delegating: false, background: [], requests: [], queue: [] })).toBe(false);
        expect(chatIsWorking(undefined)).toBe(false);
        expect(chatIsWorking(null)).toBe(false);
    });

    test('reads a turn and a wait on a person as working', () => {
        expect(chatIsWorking({ status: 'running' })).toBe(true);
        expect(chatIsWorking({ status: 'needs-you' })).toBe(true);
    });

    test('reads work that goes on while the status is idle as working', () => {
        expect(chatIsWorking({ ...quiet, delegating: true })).toBe(true);
        expect(chatIsWorking({ ...quiet, background: [{ kind: 'shell', id: 'b1', label: 'dev server' } as never] })).toBe(true);
        expect(chatIsWorking({ ...quiet, goal: { status: 'active' } as never })).toBe(true);
        expect(chatIsWorking({ ...quiet, requests: [{ id: 'r1' } as never] })).toBe(true);
        expect(chatIsWorking({ ...quiet, queue: [{ id: 'q1' } as never] })).toBe(true);
    });

    test('lets a goal that is done or paused go', () => {
        for (const status of ['complete', 'paused', 'blocked'] as const) {
            expect(chatIsWorking({ ...quiet, goal: { status } as never })).toBe(false);
        }
    });

    test('lets the card of its own suggestion hold a chat with no turn, and nothing else', () => {
        expect(chatIsWorking({ status: 'needs-you', activeTurnId: null }, true)).toBe(false);
        expect(chatIsWorking({ status: 'needs-you', activeTurnId: null }, false)).toBe(true);
        expect(chatIsWorking({ status: 'needs-you', activeTurnId: 'turn-1' }, true)).toBe(true);
        expect(chatIsWorking({ status: 'needs-you', activeTurnId: null, requests: [{ id: 'r1' } as never] }, true)).toBe(true);
        expect(chatIsWorking({ status: 'running', activeTurnId: null }, true)).toBe(true);
    });
});
