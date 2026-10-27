import { describe, expect, test } from 'bun:test';
import { linkPathOf } from './metrics';

describe('the path of a link', () => {
    test('is local for the socket of this machine, turn once relayed, and else how its signals went', () => {
        expect(linkPathOf({ socket: true, relayed: false, signaled: null })).toBe('local');
        expect(linkPathOf({ socket: false, relayed: true, signaled: 'lan' })).toBe('turn');
        expect(linkPathOf({ socket: false, relayed: false, signaled: 'lan' })).toBe('lan');
        expect(linkPathOf({ socket: false, relayed: false, signaled: 'broker' })).toBe('direct');
        expect(linkPathOf({ socket: false, relayed: false, signaled: null })).toBe('direct');
    });
});
