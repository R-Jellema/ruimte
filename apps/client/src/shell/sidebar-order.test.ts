import { describe, expect, test } from 'bun:test';
import { moveInOrder } from './sidebar-projects';

describe('moveInOrder', () => {
    test('moves a project among the ones on screen', () => {
        expect(moveInOrder(['a', 'b', 'c'], ['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b']);
        expect(moveInOrder(['a', 'b', 'c'], ['a', 'b', 'c'], 'a', 2)).toEqual(['b', 'c', 'a']);
        expect(moveInOrder(['a', 'b', 'c'], ['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'b', 'c']);
    });

    test('keeps the place of a project that is closed, so it comes back there', () => {
        // `x` is closed: it stays between `a` and `b` whatever moves around it.
        expect(moveInOrder(['a', 'x', 'b', 'c'], ['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'x', 'c', 'b']);
        expect(moveInOrder(['a', 'x', 'b', 'c'], ['a', 'b', 'c'], 'a', 2)).toEqual(['x', 'b', 'c', 'a']);
    });

    test('clamps a place past either end', () => {
        expect(moveInOrder(['a', 'b'], ['a', 'b'], 'a', 9)).toEqual(['b', 'a']);
        expect(moveInOrder(['a', 'b'], ['a', 'b'], 'b', -3)).toEqual(['b', 'a']);
    });
});
