import { describe, expect, test } from 'bun:test';
import { fitScreen, jsonExceeds } from './fit-screen.ts';

function jsonBytes(text: string): number {
    return Buffer.byteLength(JSON.stringify(text));
}

describe('jsonExceeds', () => {
    const samples = [
        '',
        'plain ascii',
        '\x1b[31mred\x1b[0m\r\n',
        'quote " and backslash \\',
        '\b\t\n\f\r\x00\x07\x1f',
        'wörd, 漢字 and an emoji 😀',
        'a lone high \ud83d surrogate',
        'a lone low \ude00 surrogate',
        'trailing high \ud83d',
        'a reversed pair \ude00\ud83d'
    ];

    test('weighs a string exactly as JSON.stringify writes it, on both sides of the limit', () => {
        for (const sample of samples) {
            const exact = jsonBytes(sample);
            expect(jsonExceeds(sample, exact)).toBe(false);
            expect(jsonExceeds(sample, exact - 1)).toBe(true);
        }
    });
});

describe('fitScreen', () => {
    test('keeps every line when the screen fits and serializes once', () => {
        const asked: number[] = [];
        const screen = fitScreen(
            (scrollback) => {
                asked.push(scrollback);
                return 'x'.repeat(scrollback);
            },
            100,
            1000
        );
        expect(screen).toHaveLength(100);
        expect(asked).toEqual([100]);
    });

    test('halves the scrollback until the screen fits in a frame, escapes counted', () => {
        const asked: number[] = [];
        const screen = fitScreen(
            (scrollback) => {
                asked.push(scrollback);
                return '\x1b'.repeat(scrollback);
            },
            100,
            200
        );
        expect(asked).toEqual([100, 50, 25]);
        expect(jsonBytes(screen)).toBeLessThanOrEqual(200);
    });
});
