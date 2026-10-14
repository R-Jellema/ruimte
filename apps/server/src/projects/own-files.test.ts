import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renameNoReplace } from '../fs/no-replace-rename.ts';
import { moveOwnFiles, ownFolderOf, type OwnFilesIO } from './own-files.ts';

let root: string;
let from: string;
let to: string;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-own-files-'));
    from = join(root, 'scratch', 'chat-1');
    to = join(root, 'vinyl');
    await mkdir(join(from, 'sketches'), { recursive: true });
    await mkdir(to);
    await writeFile(join(from, 'notes.md'), 'notes');
    await writeFile(join(from, '.env'), 'secret');
    await writeFile(join(from, 'sketches', 'a.txt'), 'sketch');
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

function error(code: string): Error {
    return Object.assign(new Error(code), { code });
}

const copyIO: OwnFilesIO['copy'] = (source, target) => cp(source, target, { recursive: true, errorOnExist: true, force: false });

async function names(folder: string): Promise<string[]> {
    return (await readdir(folder).catch(() => [])).sort();
}

describe('ownFolderOf', () => {
    test('is the folder of a chat id in the scratch folder', () => {
        expect(ownFolderOf('/home/.ruimte/scratch', 'chat-1')).toBe('/home/.ruimte/scratch/chat-1');
    });

    test('refuses an id that is more than one name', () => {
        for (const chatId of ['..', '../..', '../../etc', 'a/b', 'a\\b', '', '.']) {
            expect(() => ownFolderOf('/home/.ruimte/scratch', chatId)).toThrow(expect.objectContaining({ code: 'chat-not-found' }));
        }
    });
});

describe('moveOwnFiles', () => {
    test('moves every top-level entry, hidden ones included, and removes the emptied folder', async () => {
        const result = await moveOwnFiles(from, to);
        expect(result.moved).toEqual(['.env', 'notes.md', 'sketches']);
        expect(await names(to)).toEqual(['.env', 'notes.md', 'sketches']);
        expect(await readFile(join(to, 'sketches', 'a.txt'), 'utf8')).toBe('sketch');
        expect(await names(from)).toEqual([]);
        await expect(readdir(from)).rejects.toThrow();
    });

    test('puts everything back on undo, and a second undo does nothing', async () => {
        const result = await moveOwnFiles(from, to);
        await result.undo();
        expect(await names(from)).toEqual(['.env', 'notes.md', 'sketches']);
        expect(await names(to)).toEqual([]);
        await result.undo();
        expect(await names(from)).toEqual(['.env', 'notes.md', 'sketches']);
    });

    test('refuses a taken name before anything moved', async () => {
        await writeFile(join(to, 'notes.md'), 'other');
        await expect(moveOwnFiles(from, to)).rejects.toMatchObject({ code: 'files-conflict', message: expect.stringContaining('notes.md') });
        expect(await names(from)).toEqual(['.env', 'notes.md', 'sketches']);
        expect(await readFile(join(to, 'notes.md'), 'utf8')).toBe('other');
    });

    test('puts back what moved when a name is taken in the meantime', async () => {
        let calls = 0;
        const io: OwnFilesIO = {
            rename: async (source, target) => {
                calls += 1;
                if (calls === 2) {
                    throw error('EEXIST');
                }
                await renameNoReplace(source, target);
            },
            copy: copyIO
        };
        await expect(moveOwnFiles(from, to, io)).rejects.toMatchObject({ code: 'files-conflict' });
        expect(await names(from)).toEqual(['.env', 'notes.md', 'sketches']);
        expect(await names(to)).toEqual([]);
    });

    test('refuses a file system that cannot move without replacing, and never falls back to a replacing move', async () => {
        const io: OwnFilesIO = {
            rename: async () => {
                throw error('ENOTSUP');
            },
            copy: copyIO
        };
        await expect(moveOwnFiles(from, to, io)).rejects.toMatchObject({ code: 'move-failed' });
        expect(await names(from)).toEqual(['.env', 'notes.md', 'sketches']);
        expect(await names(to)).toEqual([]);
    });

    test('copies across a volume and deletes the originals only after every copy succeeded', async () => {
        const copies: string[] = [];
        let moving = true;
        const io: OwnFilesIO = {
            rename: async () => {
                throw error('EXDEV');
            },
            copy: async (source, target) => {
                if (moving) {
                    // Every original is still there while the copies are made.
                    expect(await names(from)).toEqual(['.env', 'notes.md', 'sketches']);
                    copies.push(target);
                }
                await copyIO(source, target);
            }
        };
        const result = await moveOwnFiles(from, to, io);
        moving = false;
        expect(copies).toHaveLength(3);
        expect(result.moved).toEqual(['.env', 'notes.md', 'sketches']);
        expect(await names(to)).toEqual(['.env', 'notes.md', 'sketches']);
        await expect(readdir(from)).rejects.toThrow();
        await result.undo();
        expect(await names(from)).toEqual(['.env', 'notes.md', 'sketches']);
        expect(await names(to)).toEqual([]);
    });

    test('keeps the originals and removes only its own copies when a copy fails', async () => {
        let calls = 0;
        const io: OwnFilesIO = {
            rename: async () => {
                throw error('EXDEV');
            },
            copy: async (source, target) => {
                calls += 1;
                if (calls === 3) {
                    await mkdir(target);
                    throw error('EIO');
                }
                await copyIO(source, target);
            }
        };
        await expect(moveOwnFiles(from, to, io)).rejects.toMatchObject({ code: 'move-failed' });
        expect(await names(from)).toEqual(['.env', 'notes.md', 'sketches']);
        expect(await names(to)).toEqual([]);
    });

    test('does not remove a name it did not make when a copy finds it taken', async () => {
        let calls = 0;
        const io: OwnFilesIO = {
            rename: async () => {
                throw error('EXDEV');
            },
            copy: async (source, target) => {
                calls += 1;
                if (calls === 2) {
                    await writeFile(target, 'someone else');
                    throw error('ERR_FS_CP_EEXIST');
                }
                await copyIO(source, target);
            }
        };
        await expect(moveOwnFiles(from, to, io)).rejects.toMatchObject({ code: 'files-conflict' });
        expect(await names(to)).toEqual(['notes.md']);
        expect(await readFile(join(to, 'notes.md'), 'utf8')).toBe('someone else');
        expect(await names(from)).toEqual(['.env', 'notes.md', 'sketches']);
    });

    test('moves nothing from a folder that is not there', async () => {
        const result = await moveOwnFiles(join(root, 'nowhere'), to);
        expect(result.moved).toEqual([]);
        await result.undo();
    });

    test('leaves a folder that is not empty after the move', async () => {
        await writeFile(join(from, 'late.md'), 'x');
        const io: OwnFilesIO = {
            rename: async (source, target) => {
                await renameNoReplace(source, target);
                await writeFile(join(from, 'late.md'), 'x');
            },
            copy: copyIO
        };
        await moveOwnFiles(from, to, io);
        expect(await names(from)).toEqual(['late.md']);
    });
});
