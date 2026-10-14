import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { JsonFileStore } from './json-file-store.ts';

const Schema = z.object({ count: z.number() });

describe('JsonFileStore', () => {
    let home: string;

    beforeEach(() => {
        home = mkdtempSync(join(tmpdir(), 'ruimte-json-file-store-'));
    });

    afterEach(() => {
        rmSync(home, { recursive: true, force: true });
    });

    test('writes plain JSON into a folder it makes and reads it back', () => {
        const path = join(home, 'nested', 'store.json');
        const store = new JsonFileStore(path, Schema, 'it starts empty');
        expect(store.read()).toBeNull();
        store.write({ count: 2 });
        expect(readFileSync(path, 'utf8')).toBe('{"count":2}');
        expect(new JsonFileStore(path, Schema, 'it starts empty').read()).toEqual({ count: 2 });
    });

    test('a file that will not read warns and reads as nothing', () => {
        const path = join(home, 'store.json');
        writeFileSync(path, '{"count":"two"}');
        const warn = spyOn(console, 'warn').mockImplementation(() => {});
        try {
            expect(new JsonFileStore(path, Schema, 'it starts empty').read()).toBeNull();
            expect(warn.mock.calls[0]?.[0]).toBe(`${path} would not read; it starts empty:`);
        } finally {
            warn.mockRestore();
        }
    });

    test('without a path it keeps nothing', () => {
        const store = new JsonFileStore(undefined, Schema, 'it starts empty');
        store.write({ count: 1 });
        expect(store.read()).toBeNull();
    });
});
