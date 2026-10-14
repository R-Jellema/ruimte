import { beforeEach, describe, expect, test } from 'bun:test';
import { join, resolve } from 'node:path';
import type { GitReposResult } from '@ruimte/contracts';
import { REPO_CACHE_TTL_MS, RepoListCache } from './repo-cache.ts';

const folder = resolve('/work/apps');
const alpha = join(folder, 'alpha');

let clock: number;
let listed: string[];
let pending: Array<ReturnType<typeof Promise.withResolvers<GitReposResult>>>;
let cache: RepoListCache;

function answer(at = 0): void {
    pending[at]!.resolve({ repos: [{ path: alpha, label: 'alpha', kind: 'nested' }], truncated: false });
}

/* The cache keeps what a listing came to only once it settled, a turn after the answer. */
async function listedOnce(): Promise<void> {
    const result = cache.get(folder);
    answer(pending.length - 1);
    await result;
    await Promise.resolve();
}

beforeEach(() => {
    clock = 0;
    listed = [];
    pending = [];
    cache = new RepoListCache(
        (path) => {
            listed.push(path);
            const next = Promise.withResolvers<GitReposResult>();
            pending.push(next);
            return next.promise;
        },
        () => clock
    );
});

describe('RepoListCache', () => {
    test('asks once per folder, also while the first listing still runs', async () => {
        const first = cache.get(folder);
        const second = cache.get(`${folder}/`);
        answer();
        expect(await first).toEqual(await second);
        expect(await cache.get(folder)).toEqual(await first);
        expect(listed).toEqual([folder]);
    });

    test('a fresh ask lists again within the time and leaves its list for the next ask', async () => {
        await listedOnce();
        const fresh = cache.get(folder, true);
        expect(listed).toHaveLength(2);
        answer(1);
        expect(await cache.get(folder)).toEqual(await fresh);
        expect(listed).toHaveLength(2);
    });

    test('lists again once the time is up', async () => {
        await listedOnce();
        clock = REPO_CACHE_TTL_MS - 1;
        void cache.get(folder);
        expect(listed).toHaveLength(1);
        clock = REPO_CACHE_TTL_MS;
        void cache.get(folder);
        expect(listed).toHaveLength(2);
    });

    test('a listing that failed is asked again at once', async () => {
        const failed = cache.get(folder);
        pending[0]!.reject(new Error('no git'));
        await expect(failed).rejects.toThrow('no git');
        await Promise.resolve();
        void cache.get(folder);
        expect(listed).toHaveLength(2);
    });

    test('a change in the folder, above it, or where a checkout keeps its name forgets it', async () => {
        for (const changed of [folder, resolve('/work'), alpha, join(alpha, '.ruimte'), join(alpha, '.idea')]) {
            await listedOnce();
            const before = listed.length;
            cache.forget([changed]);
            void cache.get(folder);
            expect(listed.length).toBe(before + 1);
            answer(pending.length - 1);
            cache.forget();
        }
    });

    test('a change deeper in a checkout or in another folder keeps the list', async () => {
        await listedOnce();
        cache.forget([join(alpha, 'src'), join(folder, 'notes'), resolve('/elsewhere')]);
        void cache.get(folder);
        expect(listed).toHaveLength(1);
    });

    test('a listing still running is dropped on any change inside the folder', async () => {
        void cache.get(folder);
        cache.forget([join(folder, 'notes')]);
        void cache.get(folder);
        expect(listed).toHaveLength(2);
    });
});
