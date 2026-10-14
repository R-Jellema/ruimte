import { join } from 'node:path';
import type { MachineMode } from '@ruimte/desktop-bridge';
import { machineModeFile, planSwitch } from '../machine-mode';
import { electron } from './electron';
import type { AppIpc } from './ipc';
import type { Machine } from './service';

const { app } = electron;

export interface MachineModeOptions {
    mode: MachineMode;
    machine: Machine;
    /* Quits and starts the app again, without the question the page already asked. */
    relaunch(): void;
}

/* The page chooses whether this app runs a machine; the shell writes it and starts over with it. */
export function installMachineMode(ipc: AppIpc, options: MachineModeOptions): void {
    const { machine } = options;
    const store = machineModeFile(join(app.getPath('userData'), 'machine.json'));

    ipc.handle('machine:found', () => machine.found());
    ipc.handle('machine:stop-preview', () => machine.stopPreview());
    ipc.handle('machine:choose', (_event, next: unknown) => {
        if (next !== 'local' && next !== 'none') {
            throw new Error('Unknown machine mode');
        }
        const plan = planSwitch(options.mode, next);
        // A write that fails rejects here, before anything stopped.
        store.write(plan.write);
        if (plan.stopMachine) {
            machine.stopOnQuit();
        }
        // The reply has to reach the page before the windows go.
        setTimeout(options.relaunch, 0);
    });
}
