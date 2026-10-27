import { describe, expect, test } from 'bun:test';
import { BenchmarkLabSchema } from '@ruimte/pulsar';
import { BENCHMARK_LABS, LAB_OF_KIND } from './benchmark-labs.ts';

describe('the benchmark labs', () => {
    test('are labs a client accepts, and every kind in the comparison has one', () => {
        const labs = new Set(BENCHMARK_LABS.map((lab) => lab.id));

        expect(labs.size).toBe(BENCHMARK_LABS.length);
        expect(Object.values(LAB_OF_KIND).filter((lab) => !labs.has(lab))).toEqual([]);

        for (const lab of BENCHMARK_LABS) {
            expect(BenchmarkLabSchema.safeParse(lab).success).toBe(true);
        }
    });
});
