import { describe, expect, test } from 'bun:test';
import { KeyedQueue } from './keyed-queue.ts';

describe('KeyedQueue', () => {
    test('keeps the order of one key, also after a rejection', async () => {
        const queue = new KeyedQueue();
        const seen: number[] = [];
        const first = queue.run('a', async () => {
            seen.push(1);
            throw new Error('boom');
        });
        const second = queue.run('a', async () => {
            seen.push(2);
            return 2;
        });
        await expect(first).rejects.toThrow('boom');
        expect(await second).toBe(2);
        expect(seen).toEqual([1, 2]);
    });

    test('forgets every key once its work has settled', async () => {
        const queue = new KeyedQueue();
        await Promise.all(Array.from({ length: 10_000 }, (_, i) => queue.run(`key-${i}`, async () => i)));
        await Promise.resolve();
        expect(queue.size).toBe(0);
    });

    test('a key queued again while running keeps its place and its entry', async () => {
        const queue = new KeyedQueue();
        const seen: string[] = [];
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const first = queue.run('a', async () => {
            await gate;
            seen.push('first');
        });
        const second = queue.run('a', async () => {
            seen.push('second');
        });
        release();
        await Promise.all([first, second]);
        await Promise.resolve();
        expect(seen).toEqual(['first', 'second']);
        expect(queue.size).toBe(0);
    });
});
