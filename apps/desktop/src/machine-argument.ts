import type { MachineMode } from '@ruimte/desktop-bridge';

/* What the main process puts on a renderer's command line to say whether this app runs a machine. */
export const MACHINE_ARGUMENT = '--ruimte-machine=';

/* Kept apart from `machine-mode.ts` so the sandboxed preload pulls in nothing that reads the disk. A mode this shell does not know reads `local`, as a shell from before the mode ran one. */
export function modeFromArgv(argv: readonly string[]): MachineMode {
    const value = argv.find((arg) => arg.startsWith(MACHINE_ARGUMENT))?.slice(MACHINE_ARGUMENT.length);
    return value === 'none' || value === 'ask' ? value : 'local';
}
