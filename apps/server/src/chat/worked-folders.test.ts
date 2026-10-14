import { describe, expect, test } from 'bun:test';
import type { ChatItem } from '@ruimte/contracts';
import { workedFolders, type WorkedFolderOptions } from './worked-folders.ts';

const HOME = '/Users/bas';
const RUIMTE_HOME = '/Users/bas/.ruimte';
const OWN = `${RUIMTE_HOME}/scratch/chat-1`;

function tool(id: string, name: string, input: unknown, extra: Partial<Extract<ChatItem, { kind: 'tool' }>> = {}): ChatItem {
    return { id, kind: 'tool', createdAt: 1, turnId: 't', toolUseId: id, name, input, output: null, state: 'done', parentToolUseId: null, ...extra };
}

// Two checkouts under home and one outside it; nothing else is a repository.
const checkouts = ['/Users/bas/Development/Projects/vinyl', '/Users/bas/Development/Projects/ruimte', '/srv/shelf'];

function options(overrides: Partial<WorkedFolderOptions> = {}): WorkedFolderOptions {
    return {
        cwd: OWN,
        home: HOME,
        ruimteHome: RUIMTE_HOME,
        gitRoot: async (directory) => checkouts.find((root) => directory === root || directory.startsWith(`${root}/`)) ?? null,
        ...overrides
    };
}

describe('workedFolders', () => {
    test('rounds Claude writes and reads up to their checkout and sorts by use', async () => {
        const items = [
            tool('a', 'Read', { file_path: '/Users/bas/Development/Projects/ruimte/README.md' }),
            tool('b', 'Write', { file_path: '/Users/bas/Development/Projects/vinyl/src/a.ts', content: 'x' }),
            tool('c', 'Edit', { file_path: '/Users/bas/Development/Projects/vinyl/src/b.ts', old_string: 'a', new_string: 'b' }),
            tool('d', 'Glob', { pattern: '*.ts', path: '/Users/bas/Development/Projects/vinyl/src' })
        ];
        expect(await workedFolders(items, options())).toEqual([
            { path: '/Users/bas/Development/Projects/vinyl', files: 3 },
            { path: '/Users/bas/Development/Projects/ruimte', files: 1 }
        ]);
    });

    test('reads the changes a Codex tool call lists', async () => {
        const items = [tool('a', 'fileChange', {}, { changes: [{ path: '/srv/shelf/app.php', kind: 'update', diff: '@@\n-a\n+b' }] })];
        expect(await workedFolders(items, options())).toEqual([{ path: '/srv/shelf', files: 1 }]);
    });

    test('counts a path once however often it came up', async () => {
        const items = [
            tool('a', 'Read', { file_path: '/srv/shelf/a.php' }),
            tool('b', 'Read', { file_path: '/srv/shelf/a.php' }),
            tool('c', 'Read', { file_path: '/srv/shelf/b.php' })
        ];
        expect(await workedFolders(items, options())).toEqual([{ path: '/srv/shelf', files: 2 }]);
    });

    test('leaves out the chat own folder, the data folder, home itself and calls that failed', async () => {
        const items = [
            tool('a', 'Write', { file_path: `${OWN}/notes.md`, content: 'x' }),
            tool('b', 'Read', { file_path: 'sketch.sql' }),
            tool('c', 'Read', { file_path: `${RUIMTE_HOME}/endpoint.json` }),
            tool('d', 'Read', { file_path: '/Users/bas/.zshrc' }),
            tool('e', 'Read', { file_path: '/srv/shelf/a.php' }, { state: 'error' }),
            tool('f', 'Read', { file_path: '/Users/bas/Documents/notes/todo.md' })
        ];
        expect(await workedFolders(items, options())).toEqual([{ path: '/Users/bas/Documents', files: 1 }]);
    });

    test('uses the folder itself outside home when there is no checkout', async () => {
        const items = [tool('a', 'Read', { file_path: '/opt/data/export.csv' })];
        expect(await workedFolders(items, options())).toEqual([{ path: '/opt/data', files: 1 }]);
    });

    test('ignores a checkout that is home or holds it', async () => {
        const items = [tool('a', 'Read', { file_path: '/Users/bas/Documents/notes/todo.md' })];
        const dotfiles = options({ gitRoot: async () => HOME });
        expect(await workedFolders(items, dotfiles)).toEqual([{ path: '/Users/bas/Documents', files: 1 }]);
    });

    test('asks for the checkout of a directory once', async () => {
        const asked: string[] = [];
        const items = [tool('a', 'Read', { file_path: '/srv/shelf/a.php' }), tool('b', 'Read', { file_path: '/srv/shelf/b.php' })];
        await workedFolders(items, options({ gitRoot: async (directory) => (asked.push(directory), '/srv/shelf') }));
        expect(asked).toEqual(['/srv/shelf']);
    });

    test('takes the path of Glob, Grep and LS for a folder, not for a file in it', async () => {
        const items = [
            tool('a', 'Glob', { pattern: '*', path: '/opt/data' }),
            tool('b', 'Grep', { pattern: 'x', path: '/Users/bas/Documents' }),
            tool('c', 'LS', { path: '/srv/shelf/app' })
        ];
        expect(await workedFolders(items, options())).toEqual([
            { path: '/opt/data', files: 1 },
            { path: '/Users/bas/Documents', files: 1 },
            { path: '/srv/shelf', files: 1 }
        ]);
    });

    test('reads a leading ~ as home', async () => {
        const items = [tool('a', 'Read', { file_path: '~/Documents/notes/todo.md' }), tool('b', 'Glob', { pattern: '*', path: '~/Sites' })];
        expect(await workedFolders(items, options())).toEqual([
            { path: '/Users/bas/Documents', files: 1 },
            { path: '/Users/bas/Sites', files: 1 }
        ]);
    });

    test('starts no git for a path inside a checkout already found', async () => {
        const asked: string[] = [];
        const items = [
            tool('a', 'Read', { file_path: '/srv/shelf/app/a.php' }),
            tool('b', 'Read', { file_path: '/srv/shelf/lib/deep/b.php' }),
            tool('c', 'Read', { file_path: '/srv/shelf/c.php' })
        ];
        const found = await workedFolders(items, options({ gitRoot: async (directory) => (asked.push(directory), '/srv/shelf') }));
        expect(found).toEqual([{ path: '/srv/shelf', files: 3 }]);
        expect(asked).toEqual(['/srv/shelf/app']);
    });
});
