import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SAVE_STREAM_PIECE_MAX, SaveStreams } from './save-streams';

const WINDOW = 1;
const OTHER_WINDOW = 2;

let folder: string;
let streams: SaveStreams;

beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'ruimte-save-streams-'));
    streams = new SaveStreams();
});

afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
});

function bytes(text: string): Uint8Array {
    return new TextEncoder().encode(text);
}

describe('a save in pieces', () => {
    test('writes beside the target and takes its name only at the end', async () => {
        const target = join(folder, 'build.zip');
        const id = await streams.begin(WINDOW, target);
        await Promise.all([streams.write(WINDOW, id, bytes('one ')), streams.write(WINDOW, id, bytes('two ')), streams.write(WINDOW, id, bytes('three'))]);

        const before = await readdir(folder);
        expect(before).toHaveLength(1);
        expect(before[0]).toStartWith('.build.zip.');
        expect(before[0]).toEndWith('.part');

        expect(await streams.end(WINDOW, id)).toBe(target);
        expect(await readdir(folder)).toEqual(['build.zip']);
        expect(await readFile(target, 'utf8')).toBe('one two three');
    });

    test('replaces a file the person chose to overwrite', async () => {
        const target = join(folder, 'build.zip');
        await writeFile(target, 'old');
        const id = await streams.begin(WINDOW, target);
        await streams.write(WINDOW, id, bytes('new'));
        await streams.end(WINDOW, id);
        expect(await readFile(target, 'utf8')).toBe('new');
    });

    test('an abort leaves nothing behind, and the id is gone after it', async () => {
        const id = await streams.begin(WINDOW, join(folder, 'build.zip'));
        await streams.write(WINDOW, id, bytes('half'));
        await streams.abort(WINDOW, id);
        expect(await readdir(folder)).toEqual([]);
        expect(() => streams.write(WINDOW, id, bytes('more'))).toThrow('No such save');
    });

    test('a window that goes takes its own saves along and leaves the others', async () => {
        const mine = await streams.begin(WINDOW, join(folder, 'mine.zip'));
        const theirs = await streams.begin(OTHER_WINDOW, join(folder, 'theirs.zip'));
        await streams.write(WINDOW, mine, bytes('a'));
        await streams.write(OTHER_WINDOW, theirs, bytes('b'));

        await streams.abortOwner(WINDOW);
        await streams.end(OTHER_WINDOW, theirs);
        expect(await readdir(folder)).toEqual(['theirs.zip']);
    });

    test('an id answers only the window that began it', async () => {
        const target = join(folder, 'build.zip');
        const id = await streams.begin(WINDOW, target);
        expect(() => streams.write(OTHER_WINDOW, id, bytes('x'))).toThrow('No such save');
        await expect(streams.end(OTHER_WINDOW, id)).rejects.toThrow('No such save');
        await streams.abort(OTHER_WINDOW, id);

        await streams.write(WINDOW, id, bytes('kept'));
        await streams.end(WINDOW, id);
        expect(await readFile(target, 'utf8')).toBe('kept');
    });

    test('a piece over the bound is refused and ends the save', async () => {
        const id = await streams.begin(WINDOW, join(folder, 'build.zip'));
        await streams.write(WINDOW, id, new Uint8Array(SAVE_STREAM_PIECE_MAX));
        await expect(streams.write(WINDOW, id, new Uint8Array(SAVE_STREAM_PIECE_MAX + 1))).rejects.toThrow('at most');
        expect(await readdir(folder)).toEqual([]);
        expect(() => streams.write(WINDOW, id, bytes('more'))).toThrow('No such save');
    });
});
