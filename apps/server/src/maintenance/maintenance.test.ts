import { describe, expect, test } from 'bun:test';
import type { Timers } from '../timers.ts';
import { Maintenance, type MaintenanceOptions, type Reclaimed, type Sweeper } from './maintenance.ts';

/* Lets every promise the last step settled run on, without a timer. */
function settled(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}

function manualTimers() {
    const pending: Array<{ run: () => void; ms: number }> = [];

    const timers: Timers = {
        set: (run, ms) => {
            const entry = { run, ms };
            pending.push(entry);

            return () => {
                const index = pending.indexOf(entry);

                if (index >= 0) {
                    pending.splice(index, 1);
                }
            };
        }
    };

    const fire = (): void => {
        const next = pending.shift();

        if (next === undefined) {
            throw new Error('No pass is scheduled');
        }

        next.run();
    };

    return { timers, pending, fire };
}

/* A sweeper whose passes end only when the test lets them. */
function heldSweeper(name = 'screenshots') {
    const calls: number[] = [];
    const releases: Array<(reclaimed: Reclaimed) => void> = [];
    const signals: AbortSignal[] = [];

    const sweeper: Sweeper = {
        name,
        sweep: (now, signal) => {
            calls.push(now);
            signals.push(signal);

            return new Promise((resolve) => releases.push(resolve));
        }
    };

    const release = async (reclaimed: Reclaimed = { files: 0, bytes: 0 }): Promise<void> => {
        releases.shift()?.(reclaimed);
        await settled();
    };

    return { sweeper, calls, signals, release };
}

function maintenance(overrides: Partial<MaintenanceOptions> & Pick<MaintenanceOptions, 'sweepers'>) {
    const clock = manualTimers();
    const logs: string[] = [];
    const state = { idle: true, now: 1_000 };

    const instance = new Maintenance({
        idle: () => state.idle,
        now: () => state.now,
        log: (line) => logs.push(line),
        timers: clock.timers,
        ...overrides
    });

    return { instance, clock, logs, state };
}

describe('Maintenance', () => {
    test('sweeps at the start and again each hour after the pass before ended, never two at once', async () => {
        const held = heldSweeper();
        const { instance, clock, state, logs } = maintenance({ sweepers: [held.sweeper] });
        instance.start();
        instance.start();

        expect(held.calls).toEqual([1_000]);
        expect(clock.pending).toHaveLength(0);

        await held.release({ files: 2, bytes: 300 });

        expect(clock.pending.map((entry) => entry.ms)).toEqual([60 * 60 * 1000]);
        expect(logs).toEqual(['Maintenance took away 2 expired screenshots (300 bytes)']);

        state.now = 5_000;
        clock.fire();

        expect(held.calls).toEqual([1_000, 5_000]);
        expect(clock.pending).toHaveLength(0);

        await held.release();

        expect(clock.pending).toHaveLength(1);
    });

    test('skips a pass while the machine is busy and tries again at the next', async () => {
        const held = heldSweeper();
        const { instance, clock, state } = maintenance({ sweepers: [held.sweeper] });
        state.idle = false;
        instance.start();
        await settled();

        expect(held.calls).toEqual([]);
        expect(clock.pending).toHaveLength(1);

        state.idle = true;
        clock.fire();

        expect(held.calls).toHaveLength(1);
    });

    test('a sweeper that fails is logged and the next one still runs', async () => {
        const after = heldSweeper('device captures');
        const failing: Sweeper = { name: 'screenshots', sweep: async () => Promise.reject(new Error('disk gone')) };
        const { instance, logs } = maintenance({ sweepers: [failing, after.sweeper] });
        instance.start();
        await settled();

        expect(logs).toEqual(['Sweeping screenshots failed: disk gone']);
        expect(after.calls).toHaveLength(1);
    });

    test('stop aborts the running pass, waits for it and schedules nothing more', async () => {
        const first = heldSweeper();
        const second = heldSweeper('device captures');
        const { instance, clock } = maintenance({ sweepers: [first.sweeper, second.sweeper] });
        instance.start();
        let stopped = false;

        const stopping = instance.stop().then(() => {
            stopped = true;
        });

        expect(first.signals[0]?.aborted).toBe(true);

        await settled();

        expect(stopped).toBe(false);

        await first.release();
        await stopping;

        expect(second.calls).toEqual([]);
        expect(clock.pending).toHaveLength(0);

        instance.start();

        expect(first.calls).toHaveLength(1);
    });
});
