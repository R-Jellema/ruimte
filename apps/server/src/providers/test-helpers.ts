import { afterEach } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Makes a fresh folder per call and removes them all after each test. Call it at the top of a test file. */
export function tempHomes(prefix: string): () => Promise<string> {
    const homes: string[] = [];

    afterEach(async () => {
        await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
    });

    return async () => {
        const folder = await mkdtemp(join(tmpdir(), prefix));
        homes.push(folder);
        return folder;
    };
}
