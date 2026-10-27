import { expect, test } from 'bun:test';
import { mkdir, readdir, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempHomes } from '../temp-home-test-helpers.ts';
import { sweepComputerScreenshots } from './screenshots.ts';

const HOUR_MS = 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

const newHome = tempHomes('ruimte-computer-shots-');

test('takes a window capture written more than an hour ago, keeps a newer one and anything that is no png', async () => {
    const home = await newHome();
    const folder = join(home, 'computer-use', 'screenshots');
    await mkdir(folder, { recursive: true });
    const written = async (name: string, ageMs: number): Promise<void> => {
        const path = join(folder, name);
        await writeFile(path, 'png');
        const at = new Date(NOW - ageMs);
        await utimes(path, at, at);
    };
    await written('TextEdit-1.png', HOUR_MS + 1_000);
    await written('TextEdit-2.png', HOUR_MS - 1_000);
    await written('notes.txt', 2 * HOUR_MS);
    expect(await sweepComputerScreenshots(home, NOW)).toEqual({ files: 1, bytes: 3 });
    expect((await readdir(folder)).sort()).toEqual(['TextEdit-2.png', 'notes.txt']);
});
