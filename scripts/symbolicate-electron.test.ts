import { describe, expect, test } from 'bun:test';
import { lookup, parseSymbols } from './symbolicate-electron';

const SYMBOLS = [
    'MODULE mac arm64 4C4C441A55553144A1B019A41D592A820 Electron Framework',
    'FILE 0 partition_alloc.cc',
    'FUNC 200 40 0 partition_alloc::OnNoMemory(unsigned long)',
    '200 40 12 0',
    'FUNC m 100 20 0 blink::Partitions::HandleOutOfMemory(unsigned long)',
    'PUBLIC 400 0 _start',
    'PUBLIC m 300 0 _helper'
].join('\n');

describe('lookup', () => {
    const table = parseSymbols(SYMBOLS);

    test('finds the function an offset falls in, with or without the multiple marker', () => {
        expect(lookup(table, 0x220, true)).toBe('partition_alloc::OnNoMemory(unsigned long)');
        expect(lookup(table, 0x110, true)).toBe('blink::Partitions::HandleOutOfMemory(unsigned long)');
    });

    test('reads an outer frame as the call one byte before its return address', () => {
        expect(lookup(table, 0x240, true)).toBeNull();
        expect(lookup(table, 0x240, false)).toBe('partition_alloc::OnNoMemory(unsigned long)');
    });

    test('falls back to the public symbol below an offset outside every function', () => {
        expect(lookup(table, 0x350, true)).toBe('_helper');
        expect(lookup(table, 0x9000, true)).toBe('_start');
        expect(lookup(table, 0x50, true)).toBeNull();
    });
});
