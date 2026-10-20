import { signalExitCode, type PtyAdapter, type PtyProcess, type PtySpawnOptions } from './pty.ts';

// A backgrounded grandchild may keep the PTY open forever, so only wait briefly for trailing output.
const PTY_DRAIN_GRACE_MS = 250;

class BunPtyProcess implements PtyProcess {
    readonly pid: number;
    private readonly process: ReturnType<typeof Bun.spawn>;
    private dataCallback: ((data: Uint8Array) => void) | null = null;
    private exitCallback: ((exitCode: number) => void) | null = null;
    private ptyClosed = false;
    private processExitCode: number | null = null;
    private exitReported = false;
    private drainTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(options: PtySpawnOptions) {
        this.process = Bun.spawn([options.shell, ...options.args], {
            cwd: options.cwd,
            env: options.env,
            terminal: {
                cols: options.cols,
                rows: options.rows,
                name: options.env.TERM ?? 'xterm-256color',
                data: (_terminal, data) => {
                    this.dataCallback?.(data);
                },
                exit: () => {
                    this.ptyClosed = true;
                    this.reportExitIfDone();
                }
            },
            onExit: (_subprocess, exitCode, signalCode) => {
                this.processExitCode = exitCode ?? signalExitCode(String(signalCode));
                this.reportExitIfDone();
            }
        });
        this.pid = this.process.pid;
    }

    write(data: string): void {
        this.process.terminal?.write(data);
    }

    resize(cols: number, rows: number): void {
        this.process.terminal?.resize(cols, rows);
    }

    kill(signal: NodeJS.Signals = 'SIGHUP'): void {
        if (this.processExitCode !== null) {
            return;
        }
        if (process.platform === 'win32') {
            this.killOnWindows(signal);
            return;
        }
        this.process.kill(signal);
    }

    /*
     * Windows has no signals, and Bun terminates the process for any it accepts (SIGHUP it refuses). An
     * interrupt is the Ctrl+C the console turns into its own event; anything else takes the whole tree,
     * since an agent the shell started is no child the console would end with it.
     */
    private killOnWindows(signal: NodeJS.Signals): void {
        if (signal === 'SIGINT') {
            this.process.terminal?.write('\x03');
            return;
        }
        Bun.spawnSync(['taskkill', '/PID', String(this.pid), '/T', '/F'], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });
        try {
            this.process.kill('SIGKILL');
        } catch {
            // taskkill already ended it.
        }
    }

    onData(callback: (data: Uint8Array) => void): void {
        this.dataCallback = callback;
    }

    onExit(callback: (exitCode: number) => void): void {
        this.exitCallback = callback;
    }

    private reportExitIfDone(): void {
        if (this.exitReported || this.processExitCode === null) {
            return;
        }
        if (!this.ptyClosed && this.drainTimer === null) {
            this.drainTimer = setTimeout(() => this.finishExit(), PTY_DRAIN_GRACE_MS);
            return;
        }
        this.finishExit();
    }

    private finishExit(): void {
        if (this.exitReported) {
            return;
        }
        this.exitReported = true;
        if (this.drainTimer !== null) {
            clearTimeout(this.drainTimer);
            this.drainTimer = null;
        }
        // Closing the master side is what lets the event loop and any lingering grandchild go.
        this.process.terminal?.close();
        this.exitCallback?.(this.processExitCode ?? 0);
    }
}

export class BunPtyAdapter implements PtyAdapter {
    spawn(options: PtySpawnOptions): PtyProcess {
        return new BunPtyProcess(options);
    }
}
