import { describe, expect, test } from 'bun:test';
import { isRealMachine, listedEndpoints, startScreenMachine } from './local-machine';

const rows = [{ id: 'local' }, { id: 'studio' }, { id: 'attic' }];

describe('the machine that served the page', () => {
    test('is listed with the rest where it is a machine', () => {
        expect(listedEndpoints(rows, true).map((row) => row.id)).toEqual(['local', 'studio', 'attic']);
    });

    test('is left out of every list on the web client, the other rows keeping their order', () => {
        expect(listedEndpoints(rows, false).map((row) => row.id)).toEqual(['studio', 'attic']);
    });

    test('never counts as a picked machine on the web client', () => {
        expect(isRealMachine('local', false)).toBe(false);
        expect(isRealMachine('studio', false)).toBe(true);
        expect(isRealMachine('local', true)).toBe(true);
    });
});

describe('the start screen', () => {
    test('keeps a link to this machine on the desktop, so its projects do not read as not connected', () => {
        expect(startScreenMachine(rows, true)).toEqual({ id: 'local' });
    });

    test('keeps no link on the web client, and none to another machine', () => {
        expect(startScreenMachine(rows, false)).toBeNull();
        expect(startScreenMachine([{ id: 'studio' }], true)).toBeNull();
    });
});
