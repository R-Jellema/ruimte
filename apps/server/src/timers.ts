import { cancellableTimeout } from '@adecore/agents';

/* A timer a test can replace, with the callback first. */
export interface Timers {
    set(run: () => void, ms: number): () => void;
}

export const realTimers: Timers = {
    set: (run, ms) => cancellableTimeout(ms, run)
};
