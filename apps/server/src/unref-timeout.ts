/* Runs `run` after `ms` without holding the process open for it; answers how to cancel it. */
export function unrefTimeout(ms: number, run: () => void): () => void {
    const timer = setTimeout(run, ms);
    timer.unref?.();
    return () => clearTimeout(timer);
}
