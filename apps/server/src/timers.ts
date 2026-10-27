/* Runs `run` after `ms` and answers how to call it off. */
export type Timer = (ms: number, run: () => void) => () => void;

export const cancellableTimeout: Timer = (ms, run) => {
    const timer = setTimeout(run, ms);

    return () => clearTimeout(timer);
};

/* The same, without holding the process open for it. */
export const unrefTimeout: Timer = (ms, run) => {
    const timer = setTimeout(run, ms);
    timer.unref?.();

    return () => clearTimeout(timer);
};

/* A timer a test can replace, with the callback first. */
export interface Timers {
    set(run: () => void, ms: number): () => void;
}

export const realTimers: Timers = {
    set: (run, ms) => cancellableTimeout(ms, run)
};
