import { describe, expect, it } from 'bun:test';
import { StorageGate } from './storage-gate.ts';

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });

    return { promise, resolve };
}

describe('StorageGate', () => {
    it('lets a waiter through at once while nothing is held', async () => {
        await new StorageGate().wait();
    });

    it('keeps a waiter until the hold ended, also when it failed', async () => {
        const gate = new StorageGate();
        const work = deferred();
        const events: string[] = [];
        const held = gate.hold(() => work.promise.then(() => Promise.reject(new Error('failed')))).catch(() => events.push('failed'));
        const waited = gate.wait().then(() => events.push('waited'));
        await Promise.resolve();

        expect(events).toEqual([]);

        work.resolve();
        await Promise.all([held, waited]);

        expect(events).toEqual(['failed', 'waited']);
    });

    it('runs one hold at a time', async () => {
        const gate = new StorageGate();
        const first = deferred();
        const events: string[] = [];
        const one = gate.hold(async () => {
            events.push('first');
            await first.promise;
        });
        const two = gate.hold(async () => {
            events.push('second');
        });
        await Promise.resolve();

        expect(events).toEqual(['first']);

        first.resolve();
        await Promise.all([one, two]);

        expect(events).toEqual(['first', 'second']);
    });
});
