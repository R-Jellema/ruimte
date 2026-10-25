import { describe, expect, test } from 'bun:test';
import type { DrawingDocument, DrawingElement } from '@ruimte/contracts';
import { ElementChanges } from './element-changes.ts';

function rect(id: string, x = 0): DrawingElement {
    return { kind: 'rect', id, x, y: 0, w: 10, h: 10, stroke: 'ink', strokeWidth: 2, seed: 1 };
}

function at(rev: number, ...elements: DrawingElement[]): DrawingDocument {
    return { version: 1, rev, elements };
}

describe('ElementChanges', () => {
    test('names only the elements that changed or went after the revision', () => {
        const changes = new ElementChanges();
        changes.note('d', at(1, rect('a'), rect('b'), rect('c')));
        changes.note('d', at(2, rect('a', 5), rect('b'), rect('c')));
        changes.note('d', at(3, rect('a', 5), rect('b')));
        expect(changes.changedSince('d', at(3, rect('a', 5), rect('b')), 1, ['a', 'b', 'c'])).toEqual(['a', 'c']);
        expect(changes.changedSince('d', at(3, rect('a', 5), rect('b')), 2, ['a', 'b', 'c'])).toEqual(['c']);
    });

    test('counts every element changed for a revision it never saw', () => {
        const changes = new ElementChanges();
        changes.note('d', at(4, rect('a')));
        expect(changes.changedSince('d', at(4, rect('a')), 3, ['a'])).toEqual(['a']);
        expect(changes.changedSince('d', at(4, rect('a')), 4, ['a'])).toEqual([]);
    });

    test('an outside write it did not see is taken in at the rev it carries', () => {
        const changes = new ElementChanges();
        changes.note('d', at(1, rect('a'), rect('b')));
        expect(changes.changedSince('d', at(3, rect('a'), rect('b', 9)), 1, ['a', 'b'])).toEqual(['b']);
    });
});
