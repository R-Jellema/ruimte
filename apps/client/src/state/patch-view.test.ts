import { afterEach, describe, expect, test } from 'bun:test';
import { readMode, usePatchView } from './patch-view.ts';

describe('how patch files open on this client', () => {
    const previousStorage = globalThis.localStorage;
    const items = new Map<string, string>();

    function stubStorage(): void {
        globalThis.localStorage = {
            getItem: (key: string) => items.get(key) ?? null,
            setItem: (key: string, value: string) => items.set(key, value)
        } as unknown as Storage;
    }

    afterEach(() => {
        globalThis.localStorage = previousStorage;
        items.clear();
        usePatchView.setState({ mode: 'patch' });
    });

    test('as a patch until a person chooses plain text', () => {
        stubStorage();
        expect(readMode()).toBe('patch');
    });

    test('the choice is kept for the next page and can be undone', () => {
        stubStorage();
        usePatchView.getState().setMode('text');
        expect(usePatchView.getState().mode).toBe('text');
        expect(readMode()).toBe('text');
        usePatchView.getState().setMode('patch');
        expect(readMode()).toBe('patch');
    });

    test('storage that refuses keeps the choice for the session', () => {
        globalThis.localStorage = {
            getItem: () => {
                throw new Error('blocked');
            },
            setItem: () => {
                throw new Error('blocked');
            }
        } as unknown as Storage;
        expect(readMode()).toBe('patch');
        usePatchView.getState().setMode('text');
        expect(usePatchView.getState().mode).toBe('text');
    });
});
