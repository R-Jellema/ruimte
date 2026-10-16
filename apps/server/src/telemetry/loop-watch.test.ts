import { describe, expect, test } from 'bun:test';
import { LoopWatch } from './loop-watch.ts';

describe('LoopWatch', () => {
    test('says nothing while the heartbeats come', () => {
        const watch = new LoopWatch(0, 5000);
        expect(watch.check(1000)).toBeNull();
        expect(watch.beat(1000)).toBeNull();
        expect(watch.check(5999)).toBeNull();
    });

    test('reports a block once, and its end once', () => {
        const watch = new LoopWatch(0, 5000);
        expect(watch.check(5000)).toEqual({ state: 'blocked', sinceMs: 5000 });
        expect(watch.check(9000)).toBeNull();
        expect(watch.beat(12_000)).toEqual({ state: 'recovered', blockedMs: 12_000 });
        expect(watch.beat(13_000)).toBeNull();
    });

    test('reports a second block after the loop answered again', () => {
        const watch = new LoopWatch(0, 5000);
        watch.check(6000);
        watch.beat(7000);
        expect(watch.check(11_000)).toBeNull();
        expect(watch.check(12_000)).toEqual({ state: 'blocked', sinceMs: 5000 });
    });
});
