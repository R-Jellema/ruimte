import { describe, expect, test } from 'bun:test';
import { docCommentsRendered, renderedDocsSettings } from '@/shell/panels/use-rendered-docs';

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

    test('switches the editor feature off, markers and shortcut included, while the feature is off', () => {
        expect(renderedDocsSettings(true, false)).toEqual({ renderDocComments: false, enabled: false });
        expect(renderedDocsSettings(true, true)).toEqual({ renderDocComments: true, enabled: true });
    });
});
