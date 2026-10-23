import { describe, expect, test } from 'bun:test';
import { byType, distribution, frameSummary, heapSummary } from './summary';

describe('the measurement summary', () => {
    test('takes percentiles by nearest rank', () => {
        const samples = Array.from({ length: 100 }, (_, index) => index + 1);
        expect(distribution(samples)).toEqual({ n: 100, p50: 50, p95: 95, p99: 99, max: 100 });
        expect(distribution([])).toEqual({ n: 0, p50: 0, p95: 0, p99: 0, max: 0 });
    });

    test('counts the frames a person notices', () => {
        const summary = frameSummary([16.7, 16.6, 18, 35, 51]);
        expect([summary.over17, summary.over33, summary.over50]).toEqual([3, 2, 1]);
    });

    test('says the heap in MiB, or nothing where the engine has none', () => {
        const mib = 1024 * 1024;
        expect(heapSummary([])).toBeNull();
        expect(
            heapSummary([
                { usedBytes: 10 * mib, totalBytes: 20 * mib, limitBytes: 4096 * mib },
                { usedBytes: 30 * mib, totalBytes: 40 * mib, limitBytes: 4096 * mib },
                { usedBytes: 20 * mib, totalBytes: 40 * mib, limitBytes: 4096 * mib }
            ])
        ).toEqual({ usedMb: { first: 10, min: 10, max: 30, last: 20 }, totalMb: 40, limitMb: 4096, samples: 3 });
    });

    test('groups input by event type', () => {
        expect(
            byType([
                { type: 'wheel', ms: 4 },
                { type: 'keydown', ms: 8 },
                { type: 'wheel', ms: 6 }
            ])
        ).toEqual({
            keydown: { n: 1, p50: 8, p95: 8, p99: 8, max: 8 },
            wheel: { n: 2, p50: 4, p95: 6, p99: 6, max: 6 }
        });
    });
});
