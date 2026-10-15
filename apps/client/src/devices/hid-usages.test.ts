import { describe, expect, test } from 'bun:test';
import { hidUsageOf } from './hid-usages';

describe('hidUsageOf', () => {
    test('maps the keys of a keyboard to their HID usages', () => {
        expect(hidUsageOf('KeyA')).toBe(0x04);
        expect(hidUsageOf('KeyZ')).toBe(0x1d);
        expect(hidUsageOf('Digit1')).toBe(0x1e);
        expect(hidUsageOf('Digit0')).toBe(0x27);
        expect(hidUsageOf('Enter')).toBe(0x28);
        expect(hidUsageOf('Space')).toBe(0x2c);
        expect(hidUsageOf('F1')).toBe(0x3a);
        expect(hidUsageOf('F12')).toBe(0x45);
        expect(hidUsageOf('ArrowUp')).toBe(0x52);
        expect(hidUsageOf('ShiftLeft')).toBe(0xe1);
        expect(hidUsageOf('MetaRight')).toBe(0xe7);
    });

    test('knows no usage for a key a device keyboard does not have', () => {
        expect(hidUsageOf('F13')).toBeNull();
        expect(hidUsageOf('MediaPlayPause')).toBeNull();
        expect(hidUsageOf('')).toBeNull();
    });
});
