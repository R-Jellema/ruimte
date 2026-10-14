import type { MachineModeBridge } from '@ruimte/desktop-bridge';

/* The `machine` member of a shell's bridge for a test; each call is a no-op or the answer a test hands in. */
export function machineBridge(mode: MachineModeBridge['mode'], overrides: Partial<MachineModeBridge> = {}): MachineModeBridge {
    return {
        mode,
        found: () => Promise.resolve(false),
        stopPreview: () => Promise.resolve({ work: null, home: '~/.ruimte', commandLine: false }),
        choose: () => Promise.resolve(),
        ...overrides
    };
}
