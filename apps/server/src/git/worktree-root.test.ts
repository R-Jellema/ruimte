import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkWorktreeRoot } from './worktree-root.ts';

let base: string;
let home: string;
let userHome: string;

beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'ruimte-wt-root-'));
    home = join(base, 'ruimte');
    userHome = join(base, 'me');
    await Promise.all([mkdir(home), mkdir(userHome)]);
});

afterEach(async () => {
    await chmod(join(base, 'locked'), 0o755).catch(() => undefined);
    await rm(base, { recursive: true, force: true });
});

describe('checkWorktreeRoot', () => {
    test('takes an existing folder and one that can be made', async () => {
        await mkdir(join(base, 'wt'));
        expect(await checkWorktreeRoot(join(base, 'wt'), home, userHome)).toEqual({ root: join(base, 'wt') });
        expect(await checkWorktreeRoot(join(base, 'deeper', 'wt'), home, userHome)).toEqual({ root: join(base, 'deeper', 'wt') });
    });

    test('refuses a relative path, the root of the disk and the home folder', async () => {
        expect(await checkWorktreeRoot('wt', home, userHome)).toMatchObject({ refusal: 'root-refused' });
        expect(await checkWorktreeRoot('/', home, userHome)).toMatchObject({ refusal: 'root-refused' });
        expect(await checkWorktreeRoot(userHome, home, userHome)).toMatchObject({ refusal: 'root-refused' });
    });

    test('refuses the data folder and what is in it, except its own worktrees folder', async () => {
        expect(await checkWorktreeRoot(home, home, userHome)).toMatchObject({ refusal: 'root-refused' });
        expect(await checkWorktreeRoot(join(home, 'projects'), home, userHome)).toMatchObject({ refusal: 'root-refused' });
        expect(await checkWorktreeRoot(join(home, 'worktrees'), home, userHome)).toEqual({ root: join(home, 'worktrees') });
    });

    test('sees through a link into the data folder', async () => {
        await symlink(home, join(base, 'link'));
        expect(await checkWorktreeRoot(join(base, 'link', 'secrets'), home, userHome)).toMatchObject({ refusal: 'root-refused' });
    });

    test('refuses a file', async () => {
        await writeFile(join(base, 'file'), 'x');
        expect(await checkWorktreeRoot(join(base, 'file'), home, userHome)).toMatchObject({ refusal: 'not-a-folder' });
        expect(await checkWorktreeRoot(join(base, 'file', 'wt'), home, userHome)).toMatchObject({ refusal: 'not-a-folder' });
    });

    // Windows ignores the write bits of a folder's mode.
    test.skipIf(process.platform === 'win32')('refuses a folder that cannot be written', async () => {
        await mkdir(join(base, 'locked'));
        await chmod(join(base, 'locked'), 0o555);
        expect(await checkWorktreeRoot(join(base, 'locked', 'wt'), home, userHome)).toMatchObject({ refusal: 'not-a-folder' });
    });
});
