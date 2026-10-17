import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GitReposResult } from '@ruimte/contracts';
import { locateFile, type LocateDeps } from './locate.ts';

let root: string;

async function file(path: string): Promise<void> {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), '');
}

function depsWith(repos: Record<string, string[]>, homes: string[] = []): LocateDeps {
    return {
        repos: async (folder): Promise<GitReposResult> => ({
            repos: (repos[folder] ?? []).map((path) => ({ path, label: path, kind: 'nested' as const })),
            truncated: false
        }),
        policy: { homes }
    };
}

beforeAll(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'locate-')));
    await file('project/src/own.ts');
    await file('project/lib/src/own.ts');
    await file('project/lib/src/deep.ts');
    await file('project/other/src/deep.ts');
    await mkdir(join(root, 'project/docs'), { recursive: true });
    await file('worktree/README.md');
});

afterAll(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('locateFile', () => {
    test("a path in the agent's own folder is the one answer, whatever else holds it", async () => {
        const project = join(root, 'project');
        const result = await locateFile({ path: 'src/own.ts', cwd: project }, depsWith({ [project]: [project, join(project, 'lib')] }));
        expect(result.matches).toEqual([join(project, 'src/own.ts')]);
    });

    test('a path that is not there is looked for in every repository inside, in their order', async () => {
        const project = join(root, 'project');
        const deps = depsWith({ [project]: [project, join(project, 'lib'), join(project, 'other')] });
        expect((await locateFile({ path: 'src/deep.ts', cwd: project }, deps)).matches).toEqual([
            join(project, 'lib/src/deep.ts'),
            join(project, 'other/src/deep.ts')
        ]);
    });

    test("an agent in a worktree finds what only the project's checkout holds", async () => {
        const project = join(root, 'project');
        const worktree = join(root, 'worktree');
        const deps = depsWith({ [worktree]: [worktree], [project]: [project, join(project, 'lib')] });
        expect((await locateFile({ path: 'src/deep.ts', cwd: worktree, folder: project }, deps)).matches).toEqual([join(project, 'lib/src/deep.ts')]);
    });

    test('a folder is found only when the link names one, and a file only when it does not', async () => {
        const project = join(root, 'project');
        const deps = depsWith({});
        expect((await locateFile({ path: 'docs', cwd: project, directory: true }, deps)).matches).toEqual([join(project, 'docs')]);
        expect((await locateFile({ path: 'docs', cwd: project }, deps)).matches).toEqual([]);
    });

    test("an absolute path is only checked, and the machine's own state is never handed out", async () => {
        const deps = depsWith({}, [join(root, 'project')]);
        expect((await locateFile({ path: join(root, 'worktree/README.md'), cwd: root }, deps)).matches).toEqual([join(root, 'worktree/README.md')]);
        expect((await locateFile({ path: join(root, 'project/src/own.ts'), cwd: root }, deps)).matches).toEqual([]);
    });

    test("a link to the machine's own state does not say that state is there", async () => {
        await file('home/local.key');
        await symlink(join(root, 'home/local.key'), join(root, 'worktree/key-link'));
        const deps = depsWith({}, [join(root, 'home')]);
        expect((await locateFile({ path: 'key-link', cwd: join(root, 'worktree') }, deps)).matches).toEqual([]);
        expect((await locateFile({ path: join(root, 'worktree/key-link'), cwd: root }, deps)).matches).toEqual([]);
    });

    test('dots in the path name the same file once', async () => {
        const project = join(root, 'project');
        const result = await locateFile({ path: './lib/../src/own.ts', cwd: project }, depsWith({}));
        expect(result.matches).toEqual([join(project, 'src/own.ts')]);
    });
});
