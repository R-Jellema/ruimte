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
        const record =
            (method: string) =>
            (...data: unknown[]) =>
                lines.push([method, ...data]);
        const target = { log: record('log'), info: record('info'), warn: record('warn'), error: record('error'), debug: record('debug') };
        stampConsole(target, () => AT);
        for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
            target[method]('message %s', method);
        }
        expect(lines).toEqual([
            ['log', '2026-10-16T08:35:12.000Z message %s', 'log'],
            ['info', '2026-10-16T08:35:12.000Z message %s', 'info'],
            ['warn', '2026-10-16T08:35:12.000Z message %s', 'warn'],
            ['error', '2026-10-16T08:35:12.000Z message %s', 'error'],
            ['debug', '2026-10-16T08:35:12.000Z message %s', 'debug']
        ]);
    });
});
