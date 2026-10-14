import { describe, expect, test } from 'bun:test';
import { EMPTY_FIND_QUERY } from '@adecore/editor-react/models';
import { findResultOf, searchOptionsOf, terminalFindColors } from './terminal-find';

function tokens(values: Record<string, string>): CSSStyleDeclaration {
    return { getPropertyValue: (name: string) => values[name] ?? '' } as CSSStyleDeclaration;
}

describe('terminalFindColors', () => {
    test('a translucent match is mixed over the terminal ground into an opaque hex', () => {
        const colors = terminalFindColors(tokens({ '--term-bg': '#08080a', '--find-match': 'rgb(250 204 21 / 0.24)', '--find-current': '#f5c542' }));
        // 250 * 0.24 + 8 * 0.76 = 66.08, 204 * 0.24 + 8 * 0.76 = 55.04, 21 * 0.24 + 10 * 0.76 = 12.64
        expect(colors.matchBackground).toBe('#42370d');
    });

    test('the active match is edged in the current color with half of it behind the text', () => {
        const colors = terminalFindColors(tokens({ '--term-bg': '#000000', '--find-match': 'rgb(250 204 21 / 0.35)', '--find-current': '#facc15' }));
        expect(colors.activeMatchBorder).toBe('#facc15');
        expect(colors.activeMatchBackground).toBe('#7d660b');
        expect(colors.matchOverviewRuler).toBe('#facc15');
        expect(colors.activeMatchColorOverviewRuler).toBe('#facc15');
    });

    test('a light ground mixes toward white and shorthand hex and percent alpha read too', () => {
        const colors = terminalFindColors(tokens({ '--term-bg': '#fff', '--find-match': 'rgba(0, 0, 0, 50%)', '--find-current': '#000' }));
        expect(colors.matchBackground).toBe('#808080');
        expect(colors.activeMatchBackground).toBe('#808080');
    });

    test('a token that is neither form leaves the ground', () => {
        const colors = terminalFindColors(tokens({ '--term-bg': '#102030', '--find-match': 'oklch(0.8 0.1 90)', '--find-current': 'red' }));
        expect(colors.matchBackground).toBe('#102030');
        expect(colors.activeMatchBorder).toBe('#102030');
    });
});

describe('searchOptionsOf', () => {
    const colors = terminalFindColors(tokens({ '--term-bg': '#000', '--find-match': '#fff', '--find-current': '#fff' }));

    test('maps the three toggles, leaves a step non-incremental and carries the decorations', () => {
        expect(searchOptionsOf({ ...EMPTY_FIND_QUERY, text: 'a', caseSensitive: true, regex: true }, colors)).toEqual({
            caseSensitive: true,
            wholeWord: false,
            regex: true,
            incremental: false,
            decorations: colors
        });
    });
});

describe('findResultOf', () => {
    test('passes the counts and turns a missing index into null', () => {
        expect(findResultOf({ resultIndex: 2, resultCount: 5 }, 1000)).toEqual({ total: 5, current: 2, limited: false });
        expect(findResultOf({ resultIndex: -1, resultCount: 0 }, 1000)).toEqual({ total: 0, current: null, limited: false });
    });

    test('an index of -1 at the limit means there are more matches than the addon keeps', () => {
        expect(findResultOf({ resultIndex: -1, resultCount: 1000 }, 1000)).toEqual({ total: 1000, current: null, limited: true });
        expect(findResultOf({ resultIndex: 3, resultCount: 1000 }, 1000)).toMatchObject({ limited: false });
    });
});
