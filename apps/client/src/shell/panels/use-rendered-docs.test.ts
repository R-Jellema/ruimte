import { describe, expect, test } from 'bun:test';
import { docCommentsRendered } from '@/shell/panels/use-rendered-docs';

describe('rendering documentation comments', () => {
    test('stays off while the feature is off, whatever the setting says', () => {
        expect(docCommentsRendered(true, false)).toBe(false);
        expect(docCommentsRendered(false, false)).toBe(false);
    });

    test('follows the setting once the feature is on', () => {
        expect(docCommentsRendered(true, true)).toBe(true);
        expect(docCommentsRendered(false, true)).toBe(false);
    });

    test('is off by default', () => {
        expect(docCommentsRendered(true)).toBe(false);
    });
});
