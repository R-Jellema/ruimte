import { describe, expect, test } from 'bun:test';
import { stampConsole, stamped } from './log-time.ts';

const AT = new Date('2026-10-16T08:35:12.000Z');

describe('stamped', () => {
    test('puts the time in front of a string', () => {
        expect(stamped(AT, ['ruimte server stopping', 3])).toEqual(['2026-10-16T08:35:12.000Z ruimte server stopping', 3]);
    });

    test('puts the time before anything else', () => {
        const error = new Error('x');
        expect(stamped(AT, [error])).toEqual(['2026-10-16T08:35:12.000Z', error]);
    });
});

describe('stampConsole', () => {
    test('stamps every method of the console it is given', () => {
        const lines: unknown[][] = [];
        const record = (...data: unknown[]) => lines.push(data);
        const target = { log: record, info: record, warn: record, error: record, debug: record };
        stampConsole(target, () => AT);
        target.log('a');
        target.error('b', 1);
        expect(lines).toEqual([['2026-10-16T08:35:12.000Z a'], ['2026-10-16T08:35:12.000Z b', 1]]);
    });
});
