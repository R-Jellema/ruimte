import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchAgentPlist } from '@adecore/service';
import { daemonServiceSpec } from '@ruimte/service/host';
import {
    decideMachineMode,
    hasInstallTraces,
    INSTALL_TRACES,
    machineModeFile,
    parseModeOverride,
    parseStoredMode,
    removeOwnDefinition,
    secretFor,
    tildeHome,
    type MachineModeFacts
} from './machine-mode';

const NOTHING: MachineModeFacts = { override: null, stored: null, traces: false, smoke: false };

describe('decideMachineMode', () => {
    test('no traces and no file asks, and stores that it asked', () => {
        expect(decideMachineMode(NOTHING)).toEqual({ mode: 'ask', write: 'ask' });
    });

    test('the files a start of ask leaves behind do not turn the next start into an earlier install', () => {
        const first = decideMachineMode(NOTHING);
        expect(decideMachineMode({ ...NOTHING, stored: first.write, traces: true })).toEqual({ mode: 'ask', write: null });
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
        expect(decideMachineMode({ ...NOTHING, override: 'local', traces: true })).toEqual({ mode: 'local', write: null });
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

    test('reads ask, which a new install keeps until it is told', () => {
        expect(parseStoredMode('{ "mode": "ask" }')).toBe('ask');
    });

    test('anything else is null', () => {
        expect(parseStoredMode(null)).toBeNull();
        expect(parseStoredMode('')).toBeNull();
        expect(parseStoredMode('garbage')).toBeNull();
        expect(parseStoredMode('null')).toBeNull();
        expect(parseStoredMode('{ "mode": "maybe" }')).toBeNull();
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

describe('tildeHome', () => {
    test('writes the home folder as a tilde', () => {
        expect(tildeHome('/Users/bas/.ruimte', '/Users/bas')).toBe('~/.ruimte');
        expect(tildeHome('/Users/bas', '/Users/bas')).toBe('~');
    });

    test('leaves a path outside the home folder, or one that only shares its prefix, as it is', () => {
        expect(tildeHome('/data/ruimte', '/Users/bas')).toBe('/data/ruimte');
        expect(tildeHome('/Users/basement/.ruimte', '/Users/bas')).toBe('/Users/basement/.ruimte');
    });

    test('follows the separator of a Windows path', () => {
        expect(tildeHome(String.raw`C:\Users\bas\.ruimte`, String.raw`C:\Users\bas`)).toBe(String.raw`~\.ruimte`);
    });
});

describe('removeOwnDefinition', () => {
    const IDENTITY = { ruimteHome: '/home/bas/.ruimte', commandLineProgram: '/home/bas/.ruimte/bin/ruimte' };

    function manager(definition: string | null) {
        const calls: string[] = [];
        return {
            calls,
            read: () => definition,
            uninstall: () => {
                calls.push('uninstall');
            }
        };
    }

    function plist(program: string, ruimteHome: string): string {
        return launchAgentPlist(
            daemonServiceSpec({ platform: 'darwin', program, args: ['--port', '4210'], home: '/home/bas', ruimteHome, path: '/usr/bin:/bin' })
        );
    }

    test('takes the definition of this installation away while the app runs its own daemon', () => {
        const own = manager(plist('/Applications/Ruimte.app/Contents/Resources/bin/ruimte', IDENTITY.ruimteHome));
        expect(removeOwnDefinition(own, IDENTITY, 'app')).toBe(true);
        expect(own.calls).toEqual(['uninstall']);
    });

    test('leaves a service that runs the machine to the quit, which stops it first', () => {
        const own = manager(plist('/Applications/Ruimte.app/Contents/Resources/bin/ruimte', IDENTITY.ruimteHome));
        expect(removeOwnDefinition(own, IDENTITY, 'service')).toBe(false);
        expect(own.calls).toEqual([]);
    });

    test('leaves the service of the command line, of another home and of nobody alone', () => {
        const commandLine = manager(plist(IDENTITY.commandLineProgram, IDENTITY.ruimteHome));
        const elsewhere = manager(plist('/Applications/Ruimte.app/Contents/Resources/bin/ruimte', '/home/bas/other'));
        const none = manager(null);
        expect([commandLine, elsewhere, none].map((entry) => removeOwnDefinition(entry, IDENTITY, 'app'))).toEqual([false, false, false]);
        expect([...commandLine.calls, ...elsewhere.calls, ...none.calls]).toEqual([]);
        expect(removeOwnDefinition(null, IDENTITY, 'app')).toBe(false);
    });
});
