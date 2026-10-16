import { describe, expect, test } from 'bun:test';
import { ARCHIVE_EXTRACT_MAX_BYTES, ARCHIVE_MAX_RATIO, ARCHIVE_RATIO_FLOOR_BYTES, ARCHIVE_SCAN_MAX_BYTES, ArchiveError, InflateMeter } from './limits.ts';

function meter(max: number): InflateMeter {
    return new InflateMeter(max, () => new ArchiveError('too-large', 'over the ceiling'));
}

describe('the inflate meter', () => {
    test('stops at its ceiling, whatever went in', () => {
        const counted = meter(1000);
        counted.take(1000);
        counted.give(1000);
        expect(() => counted.give(1)).toThrow('over the ceiling');
    });

    test('lets any ratio pass below the floor', () => {
        const counted = meter(Number.MAX_SAFE_INTEGER);
        counted.take(1);
        expect(() => counted.give(ARCHIVE_RATIO_FLOOR_BYTES)).not.toThrow();
    });

    test('stops output that grows too far past its input once past the floor', () => {
        const counted = meter(Number.MAX_SAFE_INTEGER);
        counted.take(ARCHIVE_RATIO_FLOOR_BYTES / ARCHIVE_MAX_RATIO);
        counted.give(ARCHIVE_RATIO_FLOOR_BYTES);
        try {
            counted.give(1);
            throw new Error('the meter let it through');
        } catch (e) {
            expect(e).toMatchObject({ code: 'too-compressed' });
        }
    });

    test('lets well compressed text through', () => {
        const counted = meter(Number.MAX_SAFE_INTEGER);
        counted.take(1024 * 1024);
        expect(() => counted.give(50 * 1024 * 1024)).not.toThrow();
    });

    test('the ceilings stay where a person can still unpack real work', () => {
        expect(ARCHIVE_EXTRACT_MAX_BYTES).toBe(4 * 1024 ** 3);
        expect(ARCHIVE_SCAN_MAX_BYTES).toBe(4 * 1024 ** 3);
        expect(ARCHIVE_MAX_RATIO).toBe(200);
    });
});
