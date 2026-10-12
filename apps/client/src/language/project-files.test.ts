import { describe, expect, test } from 'bun:test';
import type { EventMap, EventType, RequestMap, RequestType } from '@ruimte/contracts';
import type { Transport } from '@/transport/transport';
import { textDrafts } from '@/state/text-drafts';
import { draftFiles } from './project-files';

type Call = { type: RequestType; payload: unknown };

/* A transport that records every request and answers it with nothing, or refuses it with `refusal`. */
function fakeTransport(refusal?: string): { transport: Transport; calls: Call[] } {
    const calls: Call[] = [];
    const transport: Transport = {
        status: 'open',
        request: <T extends RequestType>(type: T, payload: RequestMap[T]['payload']) => {
            calls.push({ type, payload });
            return refusal === undefined ? Promise.resolve({} as RequestMap[T]['result']) : Promise.reject(new Error(refusal));
        },
        on:
            <E extends EventType>(_event: E, _handler: (payload: EventMap[E]) => void) =>
            () =>
                undefined,
        subscribeStatus: () => () => undefined
    };
    return { transport, calls };
}

describe('the files a workspace edit creates', () => {
    test('are made through the machine with their text', async () => {
        const { transport, calls } = fakeTransport();
        expect(await draftFiles('local', transport, 'p1').create!('/work/src/UserInterface.php', '<?php\n')).toBeNull();
        expect(calls).toEqual([{ type: 'fs.create', payload: { path: '/work/src/UserInterface.php', kind: 'file', text: '<?php\n' } }]);
    });

    test('say why the machine did not make them', async () => {
        const { transport } = fakeTransport('That path is already there');
        expect(await draftFiles('local', transport, 'p1').create!('/work/src/User.php', '')).toBe('That path is already there');
    });
});

describe('the files a workspace edit deletes', () => {
    test('are deleted through the machine', async () => {
        const { transport, calls } = fakeTransport();
        expect(await draftFiles('local', transport, 'p1').delete!('/work/src/Old.php', { recursive: false })).toBeNull();
        expect(calls).toEqual([{ type: 'fs.delete', payload: { path: '/work/src/Old.php' } }]);
    });

    test('say why the machine did not delete them', async () => {
        const { transport } = fakeTransport('That path is not there');
        expect(await draftFiles('local', transport, 'p1').delete!('/work/src/Old.php', { recursive: true })).toBe('That path is not there');
    });

    test('lose their unsaved draft', async () => {
        const { transport } = fakeTransport();
        textDrafts.stage('local', '/work/gone/a.php', { text: 'a', mtime: 1 }, 'b');
        const files = draftFiles('local', transport, 'p1');
        expect(files.isUnsaved!('/work/gone')).toBe(true);
        await files.delete!('/work/gone', { recursive: true });
        expect(textDrafts.isUnsaved('local', '/work/gone/a.php')).toBe(false);
        expect(files.isUnsaved!('/work/gone')).toBe(false);
    });
});

describe('unsaved work under a path', () => {
    test('counts a file and a folder holding an unsaved draft, but not a sibling with a similar name', () => {
        const { transport } = fakeTransport();
        const files = draftFiles('local', transport, 'p1');
        textDrafts.stage('local', '/work/dir/a.php', { text: 'a', mtime: 1 }, 'changed');
        textDrafts.stage('local', '/work/dir2/b.php', { text: 'b', mtime: 1 }, 'b');
        expect(files.isUnsaved!('/work/dir/a.php')).toBe(true);
        expect(files.isUnsaved!('/work/dir')).toBe(true);
        expect(files.isUnsaved!('/work/dir2')).toBe(false);
        expect(files.isUnsaved!('/work/di')).toBe(false);
        textDrafts.discard('local', '/work/dir/a.php');
        textDrafts.discard('local', '/work/dir2/b.php');
    });
});

describe('what is at a path', () => {
    test('is a folder when the machine lists it', async () => {
        const { transport, calls } = fakeTransport();
        expect(await draftFiles('local', transport, 'p1').isFolder!('/work/src')).toBe(true);
        expect(calls[0]).toEqual({ type: 'fs.list', payload: { path: '/work/src', depth: 1 } });
    });

    test('is nothing when the machine refuses both a read and a listing', async () => {
        const { transport } = fakeTransport('That file is not there');
        const files = draftFiles('local', transport, 'p1');
        expect(await files.isFolder!('/work/x')).toBe(false);
        expect(await files.exists!('/work/x')).toBe(false);
    });

    test('exists when the machine reads it', async () => {
        const { transport } = fakeTransport();
        expect(await draftFiles('local', transport, 'p1').exists!('/work/a.php')).toBe(true);
    });
});
