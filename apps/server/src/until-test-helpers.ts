/* Waits that resolve once their check holds, looked at again each time the caller runs `recheck`. */
export function untilChecked(): { until(check: () => boolean): Promise<void>; recheck(): void } {
    let waiters: Array<{ check: () => boolean; resolve: () => void }> = [];

    return {
        until: (check) => (check() ? Promise.resolve() : new Promise((resolve) => waiters.push({ check, resolve }))),
        recheck: () => {
            const waiting = waiters;
            waiters = [];
            for (const waiter of waiting) {
                if (waiter.check()) {
                    waiter.resolve();
                } else {
                    waiters.push(waiter);
                }
            }
        }
    };
}
