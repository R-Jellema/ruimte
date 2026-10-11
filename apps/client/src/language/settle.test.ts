// The fake daemon and manual timers do no I/O; one event-loop turn drains their promise chains.
export function settleLanguage(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}
