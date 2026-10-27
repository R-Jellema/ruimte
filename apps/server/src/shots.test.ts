import { beforeEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { pngOf } from './devices/device-test-helpers.ts';
import { keepCapture, pngSize, writeCapture } from './shots.ts';
import { tempHomes } from './temp-home-test-helpers.ts';

describe('pngSize', () => {
    test('reads the size from the header chunk of a png', () => {
        expect(pngSize(pngOf(1206, 2622))).toEqual({ width: 1206, height: 2622 });
    });

    test('answers null for anything that is not a png', () => {
        expect(pngSize(new Uint8Array(40))).toBeNull();
        expect(pngSize(pngOf(1, 1).subarray(0, 20))).toBeNull();
        expect(pngSize(new TextEncoder().encode('\u0089PNG\r\n\u001a\n    JUNK00000000'))).toBeNull();
    });
});

describe('captures', () => {
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    let home: string;

    const newHome = tempHomes('ruimte-shots-');

    beforeEach(async () => {
        home = await newHome();
    });

    test('a capture goes after a week, one placed on a canvas stays', async () => {
        const passing = await writeCapture(home, 'phone', pngOf(1, 1), 1_000);
        const placed = await keepCapture(home, 'phone', pngOf(1, 1), 1_000);
        await writeCapture(home, 'phone', pngOf(1, 1), 1_000 + WEEK_MS + 1);
        expect(existsSync(passing)).toBe(false);
        expect(existsSync(placed)).toBe(true);
    });
});
