import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { MachineMode } from '@ruimte/desktop-bridge';

/*
 * Files in `userData` that show the app ran before. `local.key` is deliberately absent: a daemon from
 * `npx ruimte service install` leaves one, and that case asks.
 */
export const INSTALL_TRACES = [
    'background-service.json',
    'window-session.json',
    'window-state.json',
    'login-path.json',
    'storage-moved-to-app-scheme',
    'release-notes.json'
];

export interface MachineModeFacts {
    override: MachineMode | null;
    stored: 'local' | 'none' | null;
    traces: boolean;
    smoke: boolean;
}

export interface MachineModeDecision {
    mode: MachineMode;
    /* Set when an earlier install is recognized, so an update never asks and the check runs once. */
    write: 'local' | null;
}

export interface MachineModeFile {
    read(): 'local' | 'none' | null;
    write(mode: 'local' | 'none'): void;
}

export function parseStoredMode(text: string | null): 'local' | 'none' | null {
    if (text === null) {
        return null;
    }
    try {
        const stored = JSON.parse(text) as { mode?: unknown } | null;
        return stored?.mode === 'local' || stored?.mode === 'none' ? stored.mode : null;
    } catch {
        return null;
    }
}

export function parseModeOverride(value: string | undefined): MachineMode | null {
    return value === 'local' || value === 'none' || value === 'ask' ? value : null;
}

export function decideMachineMode(facts: MachineModeFacts): MachineModeDecision {
    if (facts.override) {
        return { mode: facts.override, write: null };
    }
    if (facts.stored) {
        return { mode: facts.stored, write: null };
    }
    if (facts.traces) {
        return { mode: 'local', write: 'local' };
    }
    // The smoke run tests the machine path unless it is told otherwise.
    return { mode: facts.smoke ? 'local' : 'ask', write: null };
}

export function machineModeFile(path: string): MachineModeFile {
    return {
        read() {
            try {
                return parseStoredMode(readFileSync(path, 'utf8'));
            } catch {
                return null;
            }
        },
        write(mode) {
            mkdirSync(dirname(path), { recursive: true });
            writeFileSync(path, `${JSON.stringify({ mode }, null, 2)}\n`);
        }
    };
}

export function hasInstallTraces(exists: (name: string) => boolean): boolean {
    return INSTALL_TRACES.some(exists);
}

/* Without a machine the local secret stays shut, even when a daemon answers on the port. */
export async function secretFor(mode: MachineMode, read: () => Promise<string | null>): Promise<string | null> {
    return mode === 'local' ? read() : null;
}
