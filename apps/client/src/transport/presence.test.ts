import { describe, expect, test } from 'bun:test';
import type { SystemIdleState } from '@/desktop/bridge';
import { personPresent } from './presence';

const idle = (state: SystemIdleState) => async (): Promise<SystemIdleState> => state;

describe('personPresent', () => {
    test('the system says it outright on the desktop, whatever app has the focus', async () => {
        expect(await personPresent({ idleState: idle('active'), focused: () => false })).toBe(true);
        expect(await personPresent({ idleState: idle('idle'), focused: () => true })).toBe(false);
        expect(await personPresent({ idleState: idle('locked'), focused: () => true })).toBe(false);
    });

    test('without an answer from the system the page focus decides', async () => {
        expect(await personPresent({ idleState: idle('unknown'), focused: () => true })).toBe(true);
        expect(await personPresent({ idleState: null, focused: () => false })).toBe(false);
        expect(await personPresent({ idleState: () => Promise.reject(new Error('gone')), focused: () => true })).toBe(true);
    });
});
