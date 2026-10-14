import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    decideMachineMode,
    hasInstallTraces,
    INSTALL_TRACES,
    machineModeFile,
    parseModeOverride,
    parseStoredMode,
    secretFor,
    type MachineModeFacts
} from './machine-mode';

const NOTHING: MachineModeFacts = { override: null, stored: null, traces: false, smoke: false };

describe('decideMachineMode', () => {
    test('no traces and no file asks', () => {
        expect(decideMachineMode(NOTHING)).toEqual({ mode: 'ask', write: null });
    });

    test('traces of an earlier install run a machine, and write it once', () => {
        expect(decideMachineMode({ ...NOTHING, traces: true })).toEqual({ mode: 'local', write: 'local' });
    });

    test('a stored mode wins and writes nothing', () => {
        expect(decideMachineMode({ ...NOTHING, stored: 'none' })).toEqual({ mode: 'none', write: null });
        expect(decideMachineMode({ ...NOTHING, stored: 'local' })).toEqual({ mode: 'local', write: null });
    });

    test('a stored none beats traces', () => {
        expect(decideMachineMode({ ...NOTHING, stored: 'none', traces: true })).toEqual({ mode: 'none', write: null });
    });

    test('an override beats a stored mode and is never written', () => {
        expect(decideMachineMode({ ...NOTHING, override: 'none', stored: 'local', traces: true })).toEqual({ mode: 'none', write: null });
        expect(decideMachineMode({ ...NOTHING, override: 'ask' })).toEqual({ mode: 'ask', write: null });
    });

    test('the smoke run tests the machine path unless overridden', () => {
        expect(decideMachineMode({ ...NOTHING, smoke: true })).toEqual({ mode: 'local', write: null });
        expect(decideMachineMode({ ...NOTHING, smoke: true, override: 'none' })).toEqual({ mode: 'none', write: null });
    });

    test('a stored mode beats the smoke default', () => {
        expect(decideMachineMode({ ...NOTHING, smoke: true, stored: 'none' })).toEqual({ mode: 'none', write: null });
    });
});

describe('parseStoredMode', () => {
    test('reads local and none', () => {
        expect(parseStoredMode('{ "mode": "local" }')).toBe('local');
        expect(parseStoredMode('{ "mode": "none" }')).toBe('none');
    });

    test('anything else is null', () => {
        expect(parseStoredMode(null)).toBeNull();
        expect(parseStoredMode('')).toBeNull();
        expect(parseStoredMode('garbage')).toBeNull();
        expect(parseStoredMode('null')).toBeNull();
        expect(parseStoredMode('{ "mode": "ask" }')).toBeNull();
        expect(parseStoredMode('{ "mode": 1 }')).toBeNull();
    });
});

describe('parseModeOverride', () => {
    test('accepts the three modes only', () => {
        expect(parseModeOverride('local')).toBe('local');
        expect(parseModeOverride('none')).toBe('none');
        expect(parseModeOverride('ask')).toBe('ask');
        expect(parseModeOverride('LOCAL')).toBeNull();
        expect(parseModeOverride('')).toBeNull();
        expect(parseModeOverride(undefined)).toBeNull();
    });
});

describe('hasInstallTraces', () => {
    test('is true when any trace file exists', () => {
        expect(hasInstallTraces((name) => name === 'window-state.json')).toBe(true);
        expect(hasInstallTraces(() => false)).toBe(false);
    });

    test('the local key is no trace', () => {
        expect(INSTALL_TRACES).not.toContain('local.key');
    });
});

describe('machineModeFile', () => {
    test('writes the choice and reads it back', () => {
        const dir = mkdtempSync(join(tmpdir(), 'machine-mode-'));
        try {
            const file = machineModeFile(join(dir, 'nested', 'machine.json'));
            expect(file.read()).toBeNull();
            file.write('none');
            expect(file.read()).toBe('none');
            expect(readFileSync(join(dir, 'nested', 'machine.json'), 'utf8')).toBe('{\n  "mode": "none"\n}\n');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('secretFor', () => {
    const forbidden = async (): Promise<string | null> => {
        throw new Error('the local secret was read');
    };

    test('never reads the secret without a machine', async () => {
        expect(await secretFor('none', forbidden)).toBeNull();
        expect(await secretFor('ask', forbidden)).toBeNull();
    });

    test('hands out the secret of a local machine', async () => {
        expect(await secretFor('local', async () => 'secret')).toBe('secret');
    });
});
