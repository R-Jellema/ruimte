import { describe, expect, test } from 'bun:test';
import { MACHINE_ARGUMENT, modeFromArgv } from './machine-argument';

describe('modeFromArgv', () => {
    test('reads the mode the main process passed', () => {
        expect(modeFromArgv(['electron', `${MACHINE_ARGUMENT}none`])).toBe('none');
        expect(modeFromArgv([`${MACHINE_ARGUMENT}ask`])).toBe('ask');
        expect(modeFromArgv([`${MACHINE_ARGUMENT}local`])).toBe('local');
    });

    test('a missing or unknown mode reads local', () => {
        expect(modeFromArgv(['electron'])).toBe('local');
        expect(modeFromArgv([`${MACHINE_ARGUMENT}maybe`])).toBe('local');
    });
});
