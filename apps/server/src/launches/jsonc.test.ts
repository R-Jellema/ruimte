import { describe, expect, test } from 'bun:test';
import { parseJsonc } from './jsonc.ts';

describe('parsing JSON with comments', () => {
    test('comments and trailing commas are read past', () => {
        const text = `{
            // the first
            "a": 1, /* inline */
            "list": [1, 2,],
        }`;
        expect(parseJsonc(text)).toEqual({ a: 1, list: [1, 2] });
    });

    test('slashes inside a string survive', () => {
        expect(parseJsonc('{"url": "http://localhost:3000/a//b", "note": "/* not a comment */"}')).toEqual({
            url: 'http://localhost:3000/a//b',
            note: '/* not a comment */'
        });
    });

    test('text that is not JSON is null', () => {
        expect(parseJsonc('{ nope')).toBeNull();
    });
});
