import { sweepComputerScreenshots } from '../computer/screenshots.ts';
import { Maintenance, type Sweeper } from '../maintenance/maintenance.ts';
import { sweepDeviceCaptures, sweepScreenshots } from '../shots.ts';
import type { ProcessesBundle } from './processes.ts';

/* The disposable files of this machine, each on the rule of the code that writes it. */
function sweepersOf(home: string): Sweeper[] {
    return [
        { name: 'screenshots', sweep: (now, signal) => sweepScreenshots(home, now, signal) },
        { name: 'device captures', sweep: (now, signal) => sweepDeviceCaptures(home, now, signal) },
        { name: 'computer use captures', sweep: (now, signal) => sweepComputerScreenshots(home, now, signal) }
    ];
}

/*
 * Idle means no agent in a turn, since an agent may still read a shot it asked for. A terminal does not
 * count: a dev server never ends, and a pass that waited on one would never run.
 */
export function wireMaintenance(home: string, processes: ProcessesBundle): Maintenance {
    return new Maintenance({
        sweepers: sweepersOf(home),
        idle: () => processes.machineWork().agents === 0,
        now: Date.now,
        log: (line) => console.log(line)
    });
}
