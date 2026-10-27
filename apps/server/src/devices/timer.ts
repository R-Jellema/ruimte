/* Runs `run` after `ms` and answers how to call it off, so a test decides when a limit passes. */
export type Timer = (ms: number, run: () => void) => () => void;

export const realTimer: Timer = (ms, run) => {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
};
