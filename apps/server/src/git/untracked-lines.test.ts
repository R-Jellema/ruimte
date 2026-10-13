import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { untrackedNumstat } from './untracked-lines.ts';

let root: string;

beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-untracked-'));
});

afterAll(async () => {
    await rm(root, { recursive: true, force: true });
});

async function counted(name: string, content: string | Uint8Array): Promise<unknown> {
    await writeFile(join(root, name), content);
    return await untrackedNumstat(root, name);
}

describe('untrackedNumstat', () => {
    test('every line is added, the last one too when it has no newline', async () => {
        expect(await counted('closed.txt', 'one\ntwo\n')).toEqual({ path: 'closed.txt', added: 2, deleted: 0, binary: false });
        expect(await counted('open.txt', 'one\ntwo')).toEqual({ path: 'open.txt', added: 2, deleted: 0, binary: false });
        expect(await counted('crlf.txt', 'one\r\ntwo\r\n')).toEqual({ path: 'crlf.txt', added: 2, deleted: 0, binary: false });
        expect(await counted('empty.txt', '')).toEqual({ path: 'empty.txt', added: 0, deleted: 0, binary: false });
    });

    test('lines are counted across the chunks a large file is read in', async () => {
        expect(await counted('large.txt', 'line\n'.repeat(50_000))).toMatchObject({ added: 50_000, binary: false });
    });

    test('a NUL near the start makes a file binary, one further in does not', async () => {
        expect(await counted('image.bin', new Uint8Array([0x89, 0x50, 0x00, 0x0a]))).toEqual({ path: 'image.bin', added: 0, deleted: 0, binary: true });
        const late = new Uint8Array(9000).fill(0x61);
        late[8500] = 0;
        late[8999] = 0x0a;
        expect(await counted('late.txt', late)).toMatchObject({ added: 1, binary: false });
    });

    test('a directory or a path that is gone counts nothing', async () => {
        await mkdir(join(root, 'folder'));
        expect(await untrackedNumstat(root, 'folder')).toBeNull();
        expect(await untrackedNumstat(root, 'missing.txt')).toBeNull();
    });
});
