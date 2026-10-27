import { describe, expect, test } from 'bun:test';
import { locateOffset } from './dom-text';

describe('locateOffset', () => {
    test('an offset on a seam belongs to the node that starts there', () => {
        expect(locateOffset([0, 4, 9], 4)).toEqual({ index: 1, offset: 0 });
        expect(locateOffset([0, 4, 9], 3)).toEqual({ index: 0, offset: 3 });
        expect(locateOffset([0, 4, 9], 12)).toEqual({ index: 2, offset: 3 });
    });
});
