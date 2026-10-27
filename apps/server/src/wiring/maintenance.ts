import { isIdle } from '@ruimte/contracts';
import { sweepComputerScreenshots } from '../computer/screenshots.ts';
import { Maintenance, type Sweeper } from '../maintenance/maintenance.ts';
import { sweepDeviceCaptures, sweepScreenshots } from '../shots.ts';
import type { ProcessesBundle } from './processes.ts';

/* The disposable files of this machine, each on the rule of the code that writes it. */
function sweepersOf(home: string): Sweeper[] {
    // The previews of visuals join here once ADE CORE sweeps them itself (basmilius/adecore#153).
    return [
        { name: 'screenshots', sweep: (now, signal) => sweepScreenshots(home, now, signal) },
        { name: 'device captures', sweep: (now, signal) => sweepDeviceCaptures(home, now, signal) },
        { name: 'computer use captures', sweep: (now, signal) => sweepComputerScreenshots(home, now, signal) }
    ];
}

/* Idle in the sense a self-update waits for: no terminal with work in it and no agent in a turn. */
export function wireMaintenance(home: string, processes: ProcessesBundle): Maintenance {
    return new Maintenance({
        sweepers: sweepersOf(home),
        idle: () => isIdle(processes.machineWork()),
        now: Date.now,
        log: (line) => console.log(line)
    });
}
