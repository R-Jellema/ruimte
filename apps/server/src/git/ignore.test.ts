import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ignoredPaths } from './ignore.ts';
import * as run from './run.ts';

let root: string;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-ignore-'));
    await mkdir(join(root, 'dist'));
    await writeFile(join(root, 'keep.ts'), '');
    await writeFile(join(root, 'notes.log'), '');
    await writeFile(join(root, 'dist', 'bundle.js'), '');
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('ignoredPaths', () => {
    test('names what the ignore rules match, and nothing outside a repository', async () => {
        const paths = [join(root, 'keep.ts'), join(root, 'notes.log'), join(root, 'dist')];
        expect(await ignoredPaths(paths, root)).toEqual(new Set());

        await writeFile(join(root, '.gitignore'), '*.log\ndist/\n');
        await Bun.spawn(['git', 'init', '-q'], { cwd: root, stdout: 'ignore', stderr: 'ignore' }).exited;
        expect(await ignoredPaths(paths, root)).toEqual(new Set([join(root, 'notes.log'), join(root, 'dist')]));
    });

    test('a repository that ignores nothing answers with an empty set, not a failure', async () => {
        await Bun.spawn(['git', 'init', '-q'], { cwd: root, stdout: 'ignore', stderr: 'ignore' }).exited;
        expect(await ignoredPaths([join(root, 'keep.ts')], root)).toEqual(new Set());
    });

    test('no paths asks git nothing', async () => {
        expect(await ignoredPaths([], root)).toEqual(new Set());
    });

    test('asks git once for what comes in while it runs, and answers each caller its own paths', async () => {
        await writeFile(join(root, '.gitignore'), '*.log\ndist/\n');
        await Bun.spawn(['git', 'init', '-q'], { cwd: root, stdout: 'ignore', stderr: 'ignore' }).exited;
        const runs = spyOn(run, 'runGit');
        try {
            const answers = await Promise.all([
                ignoredPaths([join(root, 'keep.ts')], root),
                ignoredPaths([join(root, 'notes.log')], root),
                ignoredPaths([join(root, 'dist'), join(root, 'keep.ts')], root)
            ]);
            expect(answers).toEqual([new Set(), new Set([join(root, 'notes.log')]), new Set([join(root, 'dist')])]);
            expect(runs).toHaveBeenCalledTimes(1);
        } finally {
            runs.mockRestore();
        }
    });
});
