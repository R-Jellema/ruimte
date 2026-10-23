import { describe, expect, test } from 'bun:test';
import { WINDOW_MS, retryAfterSeconds, windowStartOf } from './rate-window.ts';

describe('rate limit windows', () => {
    const windowStart = 1_700_000_040_000;

    test('every moment of a minute counts in the window that minute starts', () => {
        expect(windowStartOf(windowStart)).toBe(windowStart);
        expect(windowStartOf(windowStart + WINDOW_MS - 1)).toBe(windowStart);
        expect(windowStartOf(windowStart + WINDOW_MS)).toBe(windowStart + WINDOW_MS);
    });

    test('a refusal names the seconds left in its window, rounded up', () => {
        expect(retryAfterSeconds(windowStart + 15_000)).toBe(45);
        expect(retryAfterSeconds(windowStart + 59_001)).toBe(1);
        expect(retryAfterSeconds(windowStart)).toBe(60);
    });
});
