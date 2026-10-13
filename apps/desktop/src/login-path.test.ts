import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileLoginPathCache, loadLoginPath, type LoginPathCache } from './login-path';

function memoryCache(initial: string | null): LoginPathCache & { value: string | null; writes: number } {
    const cache = {
        value: initial,
        writes: 0,
        read: async () => cache.value,
        write: async (path: string) => {
            cache.writes++;
            cache.value = path;
        }
    };
    return cache;
}

/* A login shell that answers only when the test says so. */
function slowShell(): { ask: () => Promise<string | null>; answer: (path: string | null) => void; asked: () => number } {
    let resolveAnswer: (path: string | null) => void = () => undefined;
    let count = 0;
    return {
        ask: () => {
            count++;
            return new Promise((resolve) => {
                resolveAnswer = resolve;
            });
        },
        answer: (path) => resolveAnswer(path),
        asked: () => count
    };
}

describe('the login PATH', () => {
    test('a later start takes the cached answer without waiting on the shell, which is asked behind it', async () => {
        const cache = memoryCache('/opt/homebrew/bin:/usr/bin');
        const shell = slowShell();
        const loaded = await loadLoginPath(cache, shell.ask);
        expect(loaded.path).toBe('/opt/homebrew/bin:/usr/bin');
        expect(shell.asked()).toBe(1);
        shell.answer('/new/bin:/usr/bin');
        await loaded.refreshed;
        expect(cache.value).toBe('/new/bin:/usr/bin');
        expect(loaded.path).toBe('/opt/homebrew/bin:/usr/bin');
    });

    test('a first start waits on the shell and keeps its answer', async () => {
        const cache = memoryCache(null);
        const shell = slowShell();
        let settled = false;
        const loading = loadLoginPath(cache, shell.ask).then((loaded) => {
            settled = true;
            return loaded;
        });
        while (shell.asked() === 0) {
            await Promise.resolve();
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(settled).toBe(false);
        shell.answer('/usr/local/bin:/usr/bin');
        expect((await loading).path).toBe('/usr/local/bin:/usr/bin');
        expect(cache.value).toBe('/usr/local/bin:/usr/bin');
    });

    test('the same answer writes nothing, and no answer keeps the last one', async () => {
        const cache = memoryCache('/usr/bin');
        const same = await loadLoginPath(cache, async () => '/usr/bin');
        await same.refreshed;
        const none = await loadLoginPath(cache, async () => null);
        await none.refreshed;
        expect(cache.writes).toBe(0);
        expect(cache.value).toBe('/usr/bin');
    });

    test('a shell that fails on a first start leaves no PATH', async () => {
        const cache = memoryCache(null);
        const loaded = await loadLoginPath(cache, () => Promise.reject(new Error('no shell')));
        expect(loaded.path).toBeNull();
        expect(cache.writes).toBe(0);
    });
});

describe('the cache file', () => {
    let directory: string;

    beforeEach(async () => {
        directory = await mkdtemp(join(tmpdir(), 'ruimte-login-path-'));
    });

    afterEach(async () => {
        await rm(directory, { recursive: true, force: true });
    });

    test('reads back what it wrote', async () => {
        const cache = fileLoginPathCache(join(directory, 'login-path.json'));
        expect(await cache.read()).toBeNull();
        await cache.write('/opt/homebrew/bin:/usr/bin');
        expect(await cache.read()).toBe('/opt/homebrew/bin:/usr/bin');
        expect(JSON.parse(await readFile(join(directory, 'login-path.json'), 'utf8'))).toEqual({ path: '/opt/homebrew/bin:/usr/bin' });
    });

    test('a file it cannot read is no answer', async () => {
        const file = join(directory, 'login-path.json');
        await writeFile(file, '{"path":');
        expect(await fileLoginPathCache(file).read()).toBeNull();
        await writeFile(file, '{"path":""}');
        expect(await fileLoginPathCache(file).read()).toBeNull();
    });
});
