import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MachineHome } from './machine-home.ts';
import { isOpenName, isOpenPath, readSearchable, searchRoot, type SearchRoot } from './searchable.ts';

let root = '';
let project = '';
let home = '';
let search: SearchRoot;

beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-searchable-')));
    project = join(root, 'project');
    home = join(root, 'home');
    await mkdir(join(project, 'docs'), { recursive: true });
    await mkdir(join(home, 'keys'), { recursive: true });
    await writeFile(join(project, 'docs', 'key.txt'), 'plain words\n');
    await writeFile(join(home, 'keys', 'key.txt'), 'secret words\n');
    search = await searchRoot(project, await new MachineHome(home).policy());
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

/* Puts the folder of secrets where `docs` was, as a link, and keeps the real one beside it. */
async function swapForLink(): Promise<void> {
    await rename(join(project, 'docs'), join(project, 'docs-real'));
    await symlink(join(home, 'keys'), join(project, 'docs'));
}

async function swapBack(): Promise<void> {
    await rm(join(project, 'docs'));
    await rename(join(project, 'docs-real'), join(project, 'docs'));
}

describe('readSearchable', () => {
    test('reads a file of the folder searched', async () => {
        expect(await readSearchable(search, 'docs/key.txt')).toBe('plain words\n');
    });

    test('reads nothing through a folder that is a link', async () => {
        await swapForLink();
        expect(await readSearchable(search, 'docs/key.txt')).toBeNull();
    });

    test('a folder swapped for a link and back right after the open fails closed', async () => {
        await swapForLink();
        expect(await readSearchable(search, 'docs/key.txt', swapBack)).toBeNull();
    });

    test('a folder swapped for a link right after the open fails closed', async () => {
        expect(await readSearchable(search, 'docs/key.txt', swapForLink)).toBeNull();
    });
});

describe('names below a folder that holds the home', () => {
    test('are judged on the name and on where it leads', async () => {
        const above = await searchRoot(root, await new MachineHome(home).policy());
        await mkdir(join(home, 'scratch'), { recursive: true });
        await writeFile(join(home, 'scratch', 'note.md'), '');
        expect(isOpenName(above, 'home/keys/key.txt')).toBe(false);
        expect(isOpenName(above, 'home/scratch/note.md')).toBe(true);
        expect(await isOpenPath(above, 'project/docs/key.txt')).toBe(true);
        await swapForLink();
        expect(await isOpenPath(above, 'project/docs/key.txt')).toBe(false);
    });
});
