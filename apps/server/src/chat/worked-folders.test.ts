import { describe, expect, test } from 'bun:test';
import { join, resolve, sep } from 'node:path';
import type { ChatItem } from '@ruimte/contracts';
import { workedFolders, type WorkedFolderOptions } from './worked-folders.ts';

const HOME = resolve('/Users/bas');
const RUIMTE_HOME = resolve('/Users/bas/.ruimte');
const OWN = join(RUIMTE_HOME, 'scratch', 'chat-1');

function tool(id: string, name: string, input: unknown, extra: Partial<Extract<ChatItem, { kind: 'tool' }>> = {}): ChatItem {
    return { id, kind: 'tool', createdAt: 1, turnId: 't', toolUseId: id, name, input, output: null, state: 'done', parentToolUseId: null, ...extra };
}

// Two checkouts under home and one outside it; nothing else is a repository.
const checkouts = [resolve('/Users/bas/Development/Projects/vinyl'), resolve('/Users/bas/Development/Projects/ruimte'), resolve('/srv/shelf')];

function options(overrides: Partial<WorkedFolderOptions> = {}): WorkedFolderOptions {
    return {
        cwd: OWN,
        home: HOME,
        ruimteHome: RUIMTE_HOME,
        gitRoot: async (directory) => checkouts.find((root) => directory === root || directory.startsWith(`${root}${sep}`)) ?? null,
        ...overrides
    };
}

describe('workedFolders', () => {
    test('rounds Claude writes and reads up to their checkout and sorts by use', async () => {
        const items = [
            tool('a', 'Read', { file_path: resolve('/Users/bas/Development/Projects/ruimte/README.md') }),
            tool('b', 'Write', { file_path: resolve('/Users/bas/Development/Projects/vinyl/src/a.ts'), content: 'x' }),
            tool('c', 'Edit', { file_path: resolve('/Users/bas/Development/Projects/vinyl/src/b.ts'), old_string: 'a', new_string: 'b' }),
            tool('d', 'Glob', { pattern: '*.ts', path: resolve('/Users/bas/Development/Projects/vinyl/src') })
        ];
        expect(await workedFolders(items, options())).toEqual([
            { path: resolve('/Users/bas/Development/Projects/vinyl'), files: 3 },
            { path: resolve('/Users/bas/Development/Projects/ruimte'), files: 1 }
        ]);
    });

    test('reads the changes a Codex tool call lists', async () => {
        const items = [tool('a', 'fileChange', {}, { changes: [{ path: resolve('/srv/shelf/app.php'), kind: 'update', diff: '@@\n-a\n+b' }] })];
        expect(await workedFolders(items, options())).toEqual([{ path: resolve('/srv/shelf'), files: 1 }]);
    });

    test('counts a path once however often it came up', async () => {
        const items = [
            tool('a', 'Read', { file_path: resolve('/srv/shelf/a.php') }),
            tool('b', 'Read', { file_path: resolve('/srv/shelf/a.php') }),
            tool('c', 'Read', { file_path: resolve('/srv/shelf/b.php') })
        ];
        expect(await workedFolders(items, options())).toEqual([{ path: resolve('/srv/shelf'), files: 2 }]);
    });

    test('leaves out the chat own folder, the data folder, home itself and calls that failed', async () => {
        const items = [
            tool('a', 'Write', { file_path: join(OWN, 'notes.md'), content: 'x' }),
            tool('b', 'Read', { file_path: 'sketch.sql' }),
            tool('c', 'Read', { file_path: join(RUIMTE_HOME, 'endpoint.json') }),
            tool('d', 'Read', { file_path: resolve('/Users/bas/.zshrc') }),
            tool('e', 'Read', { file_path: resolve('/srv/shelf/a.php') }, { state: 'error' }),
            tool('f', 'Read', { file_path: resolve('/Users/bas/Documents/notes/todo.md') })
        ];
        expect(await workedFolders(items, options())).toEqual([{ path: resolve('/Users/bas/Documents'), files: 1 }]);
    });

    test('uses the folder itself outside home when there is no checkout', async () => {
        const items = [tool('a', 'Read', { file_path: resolve('/opt/data/export.csv') })];
        expect(await workedFolders(items, options())).toEqual([{ path: resolve('/opt/data'), files: 1 }]);
    });

    test('ignores a checkout that is home or holds it', async () => {
        const items = [tool('a', 'Read', { file_path: resolve('/Users/bas/Documents/notes/todo.md') })];
        const dotfiles = options({ gitRoot: async () => HOME });
        expect(await workedFolders(items, dotfiles)).toEqual([{ path: resolve('/Users/bas/Documents'), files: 1 }]);
    });

    test('takes the path of Glob, Grep and LS for a folder, not for a file in it', async () => {
        const items = [
            tool('a', 'Glob', { pattern: '*', path: resolve('/opt/data') }),
            tool('b', 'Grep', { pattern: 'x', path: resolve('/Users/bas/Documents') }),
            tool('c', 'LS', { path: resolve('/srv/shelf/app') })
        ];
        expect(await workedFolders(items, options())).toEqual([
            { path: resolve('/opt/data'), files: 1 },
            { path: resolve('/Users/bas/Documents'), files: 1 },
            { path: resolve('/srv/shelf'), files: 1 }
        ]);
    });

    test('reads a leading ~ as home', async () => {
        const items = [tool('a', 'Read', { file_path: '~/Documents/notes/todo.md' }), tool('b', 'Glob', { pattern: '*', path: '~/Sites' })];
        expect(await workedFolders(items, options())).toEqual([
            { path: resolve('/Users/bas/Documents'), files: 1 },
            { path: resolve('/Users/bas/Sites'), files: 1 }
        ]);
    });

    test('starts no git for a path inside a checkout already found', async () => {
        const asked: string[] = [];
        const items = [
            tool('a', 'Read', { file_path: resolve('/srv/shelf/app/a.php') }),
            tool('b', 'Read', { file_path: resolve('/srv/shelf/lib/deep/b.php') }),
            tool('c', 'Read', { file_path: resolve('/srv/shelf/c.php') })
        ];
        const found = await workedFolders(items, options({ gitRoot: async (directory) => (asked.push(directory), resolve('/srv/shelf')) }));
        expect(found).toEqual([{ path: resolve('/srv/shelf'), files: 3 }]);
        expect(asked).toEqual([resolve('/srv/shelf/app')]);
    });
});
