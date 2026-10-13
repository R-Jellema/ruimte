import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MachineHome } from './machine-home.ts';
import { forgetSearchCache, fuzzyScore, listSearchableFiles, rankFiles, searchFiles } from './search.ts';

async function git(cwd: string, ...args: string[]): Promise<void> {
    const proc = Bun.spawn(['git', ...args], { cwd, stdout: 'ignore', stderr: 'ignore' });
    await proc.exited;
}

async function seed(root: string): Promise<void> {
    await mkdir(join(root, 'src', 'chat'), { recursive: true });
    await mkdir(join(root, 'node_modules', 'left-pad'), { recursive: true });
    await mkdir(join(root, '.hidden'), { recursive: true });
    await writeFile(join(root, 'src', 'chat', 'composer.ts'), '');
    await writeFile(join(root, 'src', 'chat', 'drafts.ts'), '');
    await writeFile(join(root, 'src', 'index.ts'), '');
    await writeFile(join(root, 'README.md'), '');
    await writeFile(join(root, 'secret.log'), '');
    await writeFile(join(root, 'node_modules', 'left-pad', 'index.js'), '');
    await writeFile(join(root, '.hidden', 'x.ts'), '');
}

describe('fuzzyScore', () => {
    test('needs every character in order and ignores case', () => {
        expect(fuzzyScore('cmp', 'src/chat/Composer.ts')).not.toBeNull();
        expect(fuzzyScore('pmc', 'src/chat/composer.ts')).toBeNull();
        expect(fuzzyScore('', 'anything')).toBe(0);
    });

    test('prefers the file name over a directory hit and a prefix over a scattered match', () => {
        expect(rankFiles(['chat/x.ts', 'src/chat.ts', 'src/changes/hat.ts'], 'chat', 3)).toEqual(['src/chat.ts', 'chat/x.ts', 'src/changes/hat.ts']);
    });

    test('rankFiles keeps the limit and breaks ties on length', () => {
        expect(rankFiles(['b/index.ts', 'index.ts', 'a/index.ts'], '', 2)).toEqual(['index.ts', 'a/index.ts']);
    });
});

describe('searchFiles', () => {
    let root: string;

    beforeEach(async () => {
        forgetSearchCache();
        root = await mkdtemp(join(tmpdir(), 'ruimte-search-'));
        await seed(root);
    });

    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    test('walks a plain folder, skipping dot folders and node_modules', async () => {
        const { files, truncated } = await searchFiles(root, '');
        expect(truncated).toBe(false);
        expect(files).toContain('src/chat/composer.ts');
        expect(files).toContain('README.md');
        expect(files.some((file) => file.startsWith('node_modules'))).toBe(false);
        expect(files.some((file) => file.startsWith('.hidden'))).toBe(false);
    });

    test('inside a repo it sees untracked files and what .gitignore keeps out, minus dot names and build output', async () => {
        await git(root, 'init', '-q');
        await mkdir(join(root, 'reports', 'old'), { recursive: true });
        await writeFile(join(root, 'reports', 'old', 'summary.html'), '');
        await writeFile(join(root, '.env.local'), '');
        await writeFile(join(root, '.gitignore'), '*.log\nnode_modules\nreports/\n.hidden\n*.local\n');
        const { files } = await searchFiles(root, '', 200);
        expect(files).toContain('src/index.ts');
        expect(files).toContain('.gitignore');
        expect(files).toContain('secret.log');
        expect(files).toContain('reports/old/summary.html');
        expect(files).not.toContain('.env.local');
        expect(files.some((file) => file.startsWith('node_modules'))).toBe(false);
        expect(files.some((file) => file.startsWith('.hidden'))).toBe(false);
    });

    test('an ignored file ranks behind a kept one on the same score', async () => {
        await git(root, 'init', '-q');
        await writeFile(join(root, 'notes.log'), '');
        await writeFile(join(root, 'notes.md'), '');
        await writeFile(join(root, '.gitignore'), '*.log\n');
        const { files } = await searchFiles(root, 'notes', 2);
        expect(files).toEqual(['notes.md', 'notes.log']);
    });

    test('names nothing of a home below the folder searched, apart from the folders that stay open', async () => {
        const home = join(root, 'machine');
        await mkdir(join(home, 'scratch'), { recursive: true });
        await mkdir(join(home, 'chats', 'c1.visuals'), { recursive: true });
        await writeFile(join(home, 'local.key'), '');
        await writeFile(join(home, 'chats', 'c1.jsonl'), '');
        await writeFile(join(home, 'scratch', 'notes.md'), '');
        await writeFile(join(home, 'chats', 'c1.visuals', 'page.html'), '');
        const { files } = await searchFiles(root, '', 200, await new MachineHome(home).policy());
        expect(files).toEqual(expect.arrayContaining(['machine/scratch/notes.md', 'machine/chats/c1.visuals/page.html', 'README.md']));
        expect(files.some((file) => file.endsWith('local.key') || file.endsWith('c1.jsonl'))).toBe(false);
    });

    test('ranks the query and honors the limit', async () => {
        const { files } = await searchFiles(root, 'comp', 1);
        expect(files).toEqual(['src/chat/composer.ts']);
    });
});

describe('the listing cache', () => {
    let root: string;

    beforeEach(async () => {
        forgetSearchCache();
        root = await mkdtemp(join(tmpdir(), 'ruimte-search-cache-'));
    });

    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    test('keystrokes that come while a folder is listed share that listing', () => {
        expect(listSearchableFiles(root)).toBe(listSearchableFiles(root));
    });

    test('a change drops the folders around it and keeps the rest', async () => {
        const [first, second] = [join(root, 'first'), join(root, 'second')];
        await Promise.all([mkdir(join(first, 'src'), { recursive: true }), mkdir(second)]);
        await Promise.all([listSearchableFiles(first), listSearchableFiles(second), listSearchableFiles(root)]);
        await Promise.all([writeFile(join(first, 'src', 'new.ts'), ''), writeFile(join(second, 'new.ts'), '')]);

        forgetSearchCache([join(first, 'src')]);

        expect((await listSearchableFiles(first)).files).toEqual(['src/new.ts']);
        expect((await listSearchableFiles(root)).files.sort()).toEqual(['first/src/new.ts', 'second/new.ts']);
        expect((await listSearchableFiles(second)).files).toEqual([]);
    });

    test('keeps the folders used last and lets the oldest go', async () => {
        const folders = Array.from({ length: 33 }, (_, index) => join(root, `folder-${index}`));
        await Promise.all(folders.map((folder) => mkdir(folder)));
        const oldest = listSearchableFiles(folders[0]!);
        const kept = listSearchableFiles(folders[1]!);
        await Promise.all(folders.slice(2).map((folder) => listSearchableFiles(folder)));
        expect(listSearchableFiles(folders[1]!)).toBe(kept);

        await listSearchableFiles(join(root, 'one-more'));

        expect(listSearchableFiles(folders[1]!)).toBe(kept);
        expect(listSearchableFiles(folders[0]!)).not.toBe(oldest);
    });
});
