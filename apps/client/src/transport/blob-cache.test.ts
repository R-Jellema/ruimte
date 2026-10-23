import { describe, expect, test } from 'bun:test';
import { BlobCache } from './blob-cache';

interface Deferred {
    resolve(blob: Blob): void;
    reject(e: Error): void;
    settled: Promise<void>;
}

function setup(maxIdleBytes = 1_000) {
    const live = new Set<string>();
    let next = 1;
    const cache = new BlobCache({
        maxIdleBytes,
        createUrl: () => {
            const url = `blob:test/${next++}`;
            live.add(url);
            return url;
        },
        revokeUrl: (url) => {
            live.delete(url);
        }
    });
    const loads: Record<string, number> = {};
    const pending: Record<string, Deferred> = {};
    const load = (key: string) => () => {
        loads[key] = (loads[key] ?? 0) + 1;
        const { promise, resolve, reject } = Promise.withResolvers<Blob>();
        const settled = promise.then(
            () => undefined,
            () => undefined
        );
        pending[key] = { resolve, reject, settled };
        return promise;
    };
    return { cache, live, loads, pending, load };
}

function bytes(size: number): Blob {
    return new Blob([new Uint8Array(size)]);
}

describe('BlobCache', () => {
    test('two users of one key share one load and one URL', async () => {
        const { cache, live, loads, pending, load } = setup();
        const first = cache.acquire('a', load('a'));
        const second = cache.acquire('a', load('a'));
        expect(first.current()).toEqual({ url: null, failure: null });
        pending.a!.resolve(bytes(10));
        await pending.a!.settled;
        expect(loads.a).toBe(1);
        expect(first.current().url).not.toBeNull();
        expect(second.current().url).toBe(first.current().url);
        expect(live.size).toBe(1);
    });

    test('a user hears the load land', async () => {
        const { cache, pending, load } = setup();
        const lease = cache.acquire('a', load('a'));
        let heard = 0;
        lease.subscribe(() => {
            heard += 1;
        });
        pending.a!.resolve(bytes(10));
        await pending.a!.settled;
        expect(heard).toBe(1);
    });

    test('the URL is revoked when the last user goes, and the blob is kept to make a new one', async () => {
        const { cache, live, loads, pending, load } = setup(10);
        const first = cache.acquire('a', load('a'));
        const second = cache.acquire('a', load('a'));
        pending.a!.resolve(bytes(10));
        await pending.a!.settled;
        const url = first.current().url!;
        first.release();
        expect(live.has(url)).toBe(true);
        second.release();
        expect(live.has(url)).toBe(false);

        const again = cache.acquire('a', load('a'));
        expect(loads.a).toBe(1);
        expect(again.current().url).not.toBeNull();
        expect(again.current().url).not.toBe(url);
    });

    test('blobs nobody draws are evicted oldest first once they pass the bound', async () => {
        const { cache, loads, pending, load } = setup(100);
        for (const key of ['a', 'b', 'c']) {
            const lease = cache.acquire(key, load(key));
            pending[key]!.resolve(bytes(40));
            await pending[key]!.settled;
            lease.release();
        }
        const retainedB = cache.acquire('b', load('b'));
        const retainedC = cache.acquire('c', load('c'));
        const evictedA = cache.acquire('a', load('a'));
        expect(loads).toEqual({ a: 2, b: 1, c: 1 });
        expect(retainedB.current().url).not.toBeNull();
        expect(retainedC.current().url).not.toBeNull();
        expect(evictedA.current()).toEqual({ url: null, failure: null });
    });

    test('a blob on screen is never evicted, however large', async () => {
        const { cache, loads, pending, load } = setup(100);
        const big = cache.acquire('big', load('big'));
        pending.big!.resolve(bytes(500));
        await pending.big!.settled;
        const small = cache.acquire('small', load('small'));
        pending.small!.resolve(bytes(101));
        await pending.small!.settled;
        small.release();
        expect(big.current().url).not.toBeNull();
        const again = cache.acquire('big', load('big'));
        expect(loads.big).toBe(1);
        expect(again.current().url).toBe(big.current().url);
    });

    test('another version is another key, and the old one only goes idle', async () => {
        const { cache, live, pending, load } = setup();
        const old = cache.acquire('file@1', load('file@1'));
        pending['file@1']!.resolve(bytes(10));
        await pending['file@1']!.settled;
        const fresh = cache.acquire('file@2', load('file@2'));
        old.release();
        pending['file@2']!.resolve(bytes(12));
        await pending['file@2']!.settled;
        expect(live.size).toBe(1);
        expect(fresh.current().url).not.toBeNull();
    });

    test('a failure reaches its users, is forgotten once they go, and a retry loads again', async () => {
        const { cache, loads, pending, load } = setup();
        const lease = cache.acquire('a', load('a'));
        pending.a!.reject(new Error('The machine is not connected'));
        await pending.a!.settled;
        expect(lease.current()).toEqual({ url: null, failure: 'The machine is not connected' });

        lease.retry();
        expect(loads.a).toBe(2);
        expect(lease.current().failure).toBeNull();
        pending.a!.reject(new Error('still not'));
        await pending.a!.settled;
        lease.release();

        const later = cache.acquire('a', load('a'));
        expect(loads.a).toBe(3);
        pending.a!.resolve(bytes(1));
        await pending.a!.settled;
        expect(later.current().url).not.toBeNull();
    });

    test('a load that lands after everyone left makes no URL and respects the idle budget', async () => {
        const { cache, live, loads, pending, load } = setup(10);
        cache.acquire('a', load('a')).release();
        pending.a!.resolve(bytes(10));
        await pending.a!.settled;
        expect(live.size).toBe(0);
        const again = cache.acquire('a', load('a'));
        expect(loads.a).toBe(1);
        expect(again.current().url).not.toBeNull();
        again.release();

        cache.acquire('large', load('large')).release();
        pending.large!.resolve(bytes(11));
        await pending.large!.settled;
        expect(live.size).toBe(0);
        const tooLarge = cache.acquire('large', load('large'));
        expect(loads.large).toBe(2);
        expect(tooLarge.current()).toEqual({ url: null, failure: null });
    });

    test('a released lease reads nothing and a second release changes nothing', async () => {
        const { cache, pending, load } = setup();
        const first = cache.acquire('a', load('a'));
        const second = cache.acquire('a', load('a'));
        pending.a!.resolve(bytes(10));
        await pending.a!.settled;
        first.release();
        first.release();
        expect(first.current()).toEqual({ url: null, failure: null });
        expect(second.current().url).not.toBeNull();
    });
});
