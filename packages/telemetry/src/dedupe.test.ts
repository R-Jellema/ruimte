import { describe, expect, test } from 'bun:test';
import { createDailyDedupe, eventKey, memoryDedupeStore, type DedupeStore } from './dedupe.ts';

const HOUR = 60 * 60 * 1000;

function errorEvent(value: string, functionName = 'run'): object {
    return {
        exception: { values: [{ type: 'Error', value, stacktrace: { frames: [{ filename: 'src/a.ts', function: functionName, in_app: true }] } }] }
    };
}

function clock(start = 0): { now: () => number; advance: (ms: number) => void } {
    let current = start;
    return { now: () => current, advance: (ms) => (current += ms) };
}

describe('createDailyDedupe', () => {
    test('sends the same error once a day', () => {
        const time = clock();
        const dedupe = createDailyDedupe({ now: time.now });
        expect(dedupe.admit(errorEvent('boom'))).toBe(true);
        time.advance(23 * HOUR);
        expect(dedupe.admit(errorEvent('boom'))).toBe(false);
        time.advance(HOUR);
        expect(dedupe.admit(errorEvent('boom'))).toBe(true);
    });

    test('tells errors apart by message and by frame', () => {
        const dedupe = createDailyDedupe({ now: () => 0 });
        expect(dedupe.admit(errorEvent('boom'))).toBe(true);
        expect(dedupe.admit(errorEvent('bang'))).toBe(true);
        expect(dedupe.admit(errorEvent('boom', 'other'))).toBe(true);
    });

    test('goes by the fingerprint the code gave', () => {
        const dedupe = createDailyDedupe({ now: () => 0 });
        expect(dedupe.admit({ fingerprint: ['helper-exit', 'database'], message: 'a' })).toBe(true);
        expect(dedupe.admit({ fingerprint: ['helper-exit', 'database'], message: 'b' })).toBe(false);
        expect(dedupe.admit({ fingerprint: ['helper-exit', 'language-server'], message: 'a' })).toBe(true);
    });

    test('keeps at most the limit, dropping the oldest', () => {
        const time = clock();
        const store = memoryDedupeStore();
        const dedupe = createDailyDedupe({ now: time.now, store, limit: 2 });
        for (const value of ['a', 'b', 'c']) {
            dedupe.admit(errorEvent(value));
            time.advance(1);
        }
        expect(Object.keys(store.read())).toHaveLength(2);
        expect(dedupe.admit(errorEvent('a'))).toBe(true);
        expect(dedupe.admit(errorEvent('c'))).toBe(false);
    });

    test('forgets what is older than a day when it writes', () => {
        const time = clock();
        const store = memoryDedupeStore();
        const dedupe = createDailyDedupe({ now: time.now, store });
        dedupe.admit(errorEvent('a'));
        time.advance(25 * HOUR);
        dedupe.admit(errorEvent('b'));
        expect(Object.values(store.read())).toEqual([25 * HOUR]);
    });

    test('remembers across instances through the store', () => {
        const store = memoryDedupeStore();
        expect(createDailyDedupe({ now: () => 0, store }).admit(errorEvent('a'))).toBe(true);
        expect(createDailyDedupe({ now: () => HOUR, store }).admit(errorEvent('a'))).toBe(false);
    });

    test('sends when the store cannot be read or written', () => {
        const broken: DedupeStore = {
            read: () => {
                throw new Error('unreadable');
            },
            write: () => {
                throw new Error('read-only');
            }
        };
        expect(createDailyDedupe({ now: () => 0, store: broken }).admit(errorEvent('a'))).toBe(true);
    });
});

describe('eventKey', () => {
    test('holds no text of the event', () => {
        expect(eventKey(errorEvent('a secret message'))).toMatch(/^[0-9a-f]{8}$/);
    });

    test('ignores the default fingerprint', () => {
        expect(eventKey({ fingerprint: ['{{ default }}'], message: 'x' })).toBe(eventKey({ message: 'x' }));
    });
});
