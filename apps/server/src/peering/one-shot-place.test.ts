import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OneShotPlace } from './one-shot-place.ts';

let home: string;

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-one-shot-'));
});

afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

describe('where a one-shot run works', () => {
    test('a folder of the person stays the place it runs in', async () => {
        const place = new OneShotPlace(home, { inFolder: () => false });
        expect(await place.cwdFor('/work/project')).toBe('/work/project');
        await expect(stat(join(home, 'oneshot'))).rejects.toThrow();
    });

    test('a folder made from another machine gets an empty folder of the daemon instead', async () => {
        const place = new OneShotPlace(home, { inFolder: (path) => path.startsWith('/peer/') });
        expect(await place.cwdFor('/peer/task')).toBe(join(home, 'oneshot'));
        expect((await stat(join(home, 'oneshot'))).isDirectory()).toBe(true);
        // A second run finds the folder there already.
        expect(await place.cwdFor('/peer/task')).toBe(join(home, 'oneshot'));
        expect(await place.cwdFor('/work/project')).toBe('/work/project');
    });
});
