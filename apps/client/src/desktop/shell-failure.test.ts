import { describe, expect, test } from 'bun:test';
import { isShellFailure } from './shell-failure';

describe('isShellFailure', () => {
    test('recognizes the sentence Electron wraps around a handler that threw', () => {
        expect(isShellFailure(new Error("Error invoking remote method 'machine:choose': Error: EACCES"))).toBe(true);
    });

    test('leaves the sentences of the page itself alone', () => {
        expect(isShellFailure(new Error('the account refused'))).toBe(false);
        expect(isShellFailure('Error invoking remote method')).toBe(false);
    });
});
