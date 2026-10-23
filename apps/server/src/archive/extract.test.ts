import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { WriteBoundary } from '../fs/write.ts';
import { planExtract, type ExtractRequest } from './extract.ts';
import { buildTar, buildZip } from './test-archives.ts';

let root: string;
let project: string;
let boundary: WriteBoundary;

beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-extract-')));
    project = join(root, 'project');
    await mkdir(join(project, '.git'), { recursive: true });
    await mkdir(join(project, '.ruimte'));
    boundary = { folders: [project], worktreesOf: async () => [], worktreesRoot: join(root, 'worktrees') };
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

async function put(name: string, bytes: Uint8Array): Promise<string> {
    const path = join(project, name);
    await writeFile(path, bytes);
    return path;
}

async function extract(request: ExtractRequest) {
    return (await planExtract(request, boundary)).run();
}

describe('extracting an archive', () => {
    test('writes its files and folders into a new folder, with their times and the executable bit', async () => {
        const archives = [
            {
                format: 'zip',
                bytes: buildZip([
                    { name: 'docs/' },
                    { name: 'docs/a.md', data: '# A' },
                    { name: 'run.sh', data: '#!/bin/sh\n', mode: 0o100755 },
                    { name: 'empty/' }
                ])
            },
            {
                format: 'tar',
                bytes: buildTar([
                    { name: 'docs/', type: '5' },
                    { name: 'docs/a.md', data: '# A', mtime: 1_700_000_002 },
                    { name: 'run.sh', data: '#!/bin/sh\n', mode: 0o100755, mtime: 1_700_000_004 },
                    { name: 'empty/', type: '5' }
                ])
            }
        ];
        for (const { format, bytes } of archives) {
            const path = await put(`site.${format}`, bytes);
            const to = join(project, format);
            const result = await extract({ path, to });
            expect(result).toMatchObject({ to, files: 2, directories: 2, bytes: 13, skipped: [], skippedTotal: 0 });
            expect(await readFile(join(to, 'docs', 'a.md'), 'utf-8')).toBe('# A');
            if (format === 'tar') {
                expect((await stat(join(to, 'docs', 'a.md'))).mtimeMs).toBe(1_700_000_002_000);
                expect((await stat(join(to, 'run.sh'))).mtimeMs).toBe(1_700_000_004_000);
            }
            if (process.platform !== 'win32') {
                expect((await stat(join(to, 'run.sh'))).mode & 0o100).toBe(0o100);
                expect((await stat(join(to, 'docs', 'a.md'))).mode & 0o111).toBe(0);
            }
            expect((await stat(join(to, 'empty'))).isDirectory()).toBe(true);
        }
    });

    test('never makes a link, never writes an escaping name or into .git, and says what it left out', async () => {
        const path = await put(
            'mean.zip',
            buildZip([
                { name: 'ok.txt', data: 'fine' },
                { name: 'link', data: '/etc/passwd', method: 0, mode: 0o120777 },
                { name: '../escape.txt', data: 'out' },
                { name: 'nested/.git/hooks/post-checkout', data: '#!/bin/sh' },
                { name: 'secret', data: 'x', encrypted: true },
                { name: 'ok.txt', data: 'twice' }
            ])
        );
        const to = join(project, 'mean');
        const result = await extract({ path, to });
        expect(result.files).toBe(1);
        expect(result.skipped).toEqual([
            { path: 'link', reason: 'link' },
            { path: '../escape.txt', reason: 'unsafe-name' },
            { path: 'nested/.git/hooks/post-checkout', reason: 'closed' },
            { path: 'secret', reason: 'unreadable' },
            { path: 'ok.txt', reason: 'duplicate' }
        ]);
        expect(await readFile(join(to, 'ok.txt'), 'utf-8')).toBe('fine');
        expect(await readdir(to)).toEqual(['ok.txt']);
        expect(await readdir(project)).not.toContain('escape.txt');
    });

    test('takes only what was picked, a folder with everything under it', async () => {
        const path = await put(
            'pick.tar',
            buildTar([
                { name: 'a/', type: '5' },
                { name: 'a/one.txt', data: '1' },
                { name: 'ab/two.txt', data: '2' },
                { name: 'b.txt', data: 'b' }
            ])
        );
        const to = join(project, 'pick');
        expect(await extract({ path, to, entries: ['a'] })).toMatchObject({ files: 1, directories: 1 });
        expect(await readdir(to)).toEqual(['a']);
        await expect(extract({ path, to: join(project, 'none'), entries: ['missing'] })).rejects.toMatchObject({ code: 'entry-not-found' });
        await expect(extract({ path, to: join(project, 'bad'), entries: ['../a'] })).rejects.toMatchObject({ code: 'bad-path' });
    });

    test('unpacks a compressed tar', async () => {
        const path = await put('logs.tgz', gzipSync(buildTar([{ name: 'logs/today.log', data: 'line\n' }])));
        await extract({ path, to: join(project, 'logs') });
        expect(await readFile(join(project, 'logs', 'logs', 'today.log'), 'utf-8')).toBe('line\n');
    });

    test('refuses a folder outside the project, in .git or in .ruimte', async () => {
        const path = await put('a.zip', buildZip([{ name: 'a.txt', data: 'a' }]));
        await expect(extract({ path, to: join(root, 'elsewhere') })).rejects.toMatchObject({ code: 'outside-project' });
        await expect(extract({ path, to: join(project, '.git', 'x') })).rejects.toMatchObject({ code: 'git-state' });
        await expect(extract({ path, to: join(project, '.ruimte', 'x') })).rejects.toMatchObject({ code: 'ruimte-state' });
        await expect(extract({ path, to: 'relative/folder' })).rejects.toMatchObject({ code: 'bad-path' });
        await expect(extract({ path, to: path })).rejects.toMatchObject({ code: 'not-a-directory' });
    });

    test('refuses a file that is already there before it writes anything', async () => {
        const path = await put(
            'b.zip',
            buildZip([
                { name: 'new.txt', data: 'new' },
                { name: 'taken.txt', data: 'theirs' }
            ])
        );
        const to = join(project, 'existing');
        await mkdir(to);
        await writeFile(join(to, 'taken.txt'), 'mine');
        await expect(extract({ path, to })).rejects.toMatchObject({ code: 'exists' });
        expect(await readdir(to)).toEqual(['taken.txt']);
        expect(await readFile(join(to, 'taken.txt'), 'utf-8')).toBe('mine');
    });

    test('adds to a folder that is there when nothing in it is in the way', async () => {
        const path = await put('c.zip', buildZip([{ name: 'docs/b.md', data: 'b' }]));
        const to = join(project, 'merged');
        await mkdir(join(to, 'docs'), { recursive: true });
        await writeFile(join(to, 'docs', 'a.md'), 'a');
        await extract({ path, to });
        expect((await readdir(join(to, 'docs'))).sort()).toEqual(['a.md', 'b.md']);
    });

    test('does not follow a link in the folder it adds to', async () => {
        const outside = join(root, 'outside');
        await mkdir(outside);
        const to = join(project, 'linked');
        await mkdir(to);
        await symlink(outside, join(to, 'docs'));
        const path = await put('d.zip', buildZip([{ name: 'docs/evil.txt', data: 'out' }]));
        await expect(extract({ path, to })).rejects.toMatchObject({ code: 'outside-project' });
        expect(await readdir(outside)).toEqual([]);
    });

    test('stops a zip bomb and leaves no half file behind', async () => {
        const path = await put('bomb.zip', buildZip([{ name: 'zeros.bin', data: new Uint8Array(20 * 1024 * 1024) }]));
        const to = join(project, 'bomb');
        await expect(extract({ path, to })).rejects.toMatchObject({ code: 'too-compressed' });
        expect(await readdir(to)).toEqual([]);
    });
});
