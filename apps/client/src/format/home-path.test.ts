import { describe, expect, test } from 'bun:test';
import { withTilde } from './home-path';

describe('a path under the home folder', () => {
    test('starts with a tilde', () => {
        expect(withTilde('/Users/bas/.claude/settings.json', '/Users/bas')).toBe('~/.claude/settings.json');
        expect(withTilde('/Users/bas', '/Users/bas/')).toBe('~');
    });

    test('is left alone elsewhere and for a home that merely shares a prefix', () => {
        expect(withTilde('/etc/hosts', '/Users/bas')).toBe('/etc/hosts');
        expect(withTilde('/Users/basil/x', '/Users/bas')).toBe('/Users/basil/x');
        expect(withTilde('/Users/bas/x', null)).toBe('/Users/bas/x');
    });
});
