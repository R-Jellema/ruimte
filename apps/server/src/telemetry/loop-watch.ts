export const HANG_THRESHOLD_MS = 5000;
export const HEARTBEAT_MS = 1000;

export type LoopVerdict = { state: 'blocked'; sinceMs: number } | { state: 'recovered'; blockedMs: number } | null;

/*
 * Tells from the heartbeats of the main thread whether its event loop is stuck. Runs in the watchdog
 * worker, which keeps ticking while the main thread does not; a block is reported once, and its end once.
 */
export class LoopWatch {
    private lastBeat: number;
    private blocked = false;
    private readonly thresholdMs: number;

    constructor(now: number, thresholdMs = HANG_THRESHOLD_MS) {
        this.lastBeat = now;
        this.thresholdMs = thresholdMs;
    }

    beat(now: number): LoopVerdict {
        const silentMs = now - this.lastBeat;
        this.lastBeat = now;
        if (!this.blocked) {
            return null;
        }
        this.blocked = false;
        return { state: 'recovered', blockedMs: silentMs };
    }

    check(now: number): LoopVerdict {
        const silentMs = now - this.lastBeat;
        if (this.blocked || silentMs < this.thresholdMs) {
            return null;
        }
        this.blocked = true;
        return { state: 'blocked', sinceMs: silentMs };
    }
}
