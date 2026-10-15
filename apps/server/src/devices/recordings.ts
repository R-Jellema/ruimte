import { DeviceError } from './manager.ts';

/* A recorder running on the machine, which writes its file whole only once it was interrupted and exited. */
export interface RecordingProcess {
    readonly exited: Promise<number>;
    interrupt(): void;
    kill(): void;
}

export type RecordingLauncher = (command: readonly string[]) => RecordingProcess;

/* Runs `run` after `ms` and answers how to call it off, so a test decides when a limit passes. */
export type RecordingTimer = (ms: number, run: () => void) => () => void;

export function spawnRecording(command: readonly string[]): RecordingProcess {
    const child = Bun.spawn([...command], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });
    return {
        exited: child.exited,
        interrupt: () => child.kill('SIGINT'),
        kill: () => child.kill('SIGKILL')
    };
}

export const realTimer: RecordingTimer = (ms, run) => {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
};

/* How long a recorder may take to close its file after the interrupt before it is killed and the file given up. */
const CLOSE_GRACE_MS = 15_000;

interface Recording {
    file: string;
    process: RecordingProcess;
    ended: boolean;
    cancelLimit: () => void;
}

/*
 * The one recording a device may have. A recording that ended on its own (its limit, the recorder
 * stopping) stays until it is stopped, so the person still gets its file.
 */
export class DeviceRecordings {
    private readonly launch: RecordingLauncher;
    private readonly timer: RecordingTimer;
    private readonly running = new Map<string, Recording>();

    constructor(launch: RecordingLauncher = spawnRecording, timer: RecordingTimer = realTimer) {
        this.launch = launch;
        this.timer = timer;
    }

    isRecording(deviceId: string): boolean {
        const recording = this.running.get(deviceId);
        return recording !== undefined && !recording.ended;
    }

    /* `limitMs` interrupts the recorder by itself; null leaves the limit to the recorder. */
    start(deviceId: string, file: string, command: readonly string[], limitMs: number | null): void {
        if (this.isRecording(deviceId)) {
            throw new DeviceError('device-recording', 'This device is already being recorded');
        }
        this.running.get(deviceId)?.cancelLimit();
        const process = this.launch(command);
        const recording: Recording = { file, process, ended: false, cancelLimit: () => undefined };
        if (limitMs !== null) {
            recording.cancelLimit = this.timer(limitMs, () => process.interrupt());
        }
        void process.exited.then(() => {
            recording.ended = true;
            recording.cancelLimit();
        });
        this.running.set(deviceId, recording);
    }

    /*
     * Ends the recording with `interrupt` unless it ended already, waits until its recorder exited,
     * and answers its file after `collect` brought it to the machine.
     */
    async stop(
        deviceId: string,
        interrupt: (process: RecordingProcess) => Promise<void> | void,
        collect: (file: string) => Promise<void> = async () => undefined
    ): Promise<string> {
        const recording = this.running.get(deviceId);
        if (recording === undefined) {
            throw new DeviceError('device-not-recording', 'This device is not being recorded');
        }
        this.running.delete(deviceId);
        recording.cancelLimit();
        if (!recording.ended) {
            await interrupt(recording.process);
            let gaveUp = false;
            const cancel = this.timer(CLOSE_GRACE_MS, () => {
                gaveUp = true;
                recording.process.kill();
            });
            await recording.process.exited;
            cancel();
            if (gaveUp) {
                throw new DeviceError('device-capture-failed', 'The recording did not finish writing its video');
            }
        }
        await collect(recording.file);
        return recording.file;
    }

    /* Ends every recording without keeping its file, for a device that shut down. */
    drop(deviceId: string): void {
        const recording = this.running.get(deviceId);
        this.running.delete(deviceId);
        recording?.cancelLimit();
        if (recording !== undefined && !recording.ended) {
            recording.process.interrupt();
        }
    }
}
