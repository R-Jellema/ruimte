export interface StartupDeps {
    /* Brings a daemon up behind the port that proved it holds the local secret; false when the person chose to quit. */
    startMachine(): Promise<boolean>;
    /* Moves what the page kept under its old origin; the answer closes the window that did it. */
    moveStorage(): Promise<() => void>;
    /* The windows of the last session, or one on the start screen. */
    restoreWindows(): void;
    startUpdater(): void;
    /* From here on the page may have the local secret, and a pending restart is watched. */
    machineReady(): void;
    fail(message: string): void;
    quit(): void;
    /* The smoke run's one window, which opens once the machine is ready instead of the last session's. */
    smoke?: () => Promise<void>;
}

/*
 * The windows open while the machine still comes up, since the shell serves the page itself. What a
 * page reads of its storage has to be moved before it loads, and the local secret waits for the proof.
 */
export async function startApp(deps: StartupDeps): Promise<void> {
    let stopped = false;
    const machine = deps.startMachine().then(
        (started) => {
            if (!started) {
                stopped = true;
                deps.quit();
            }
            return started;
        },
        (e: unknown) => {
            stopped = true;
            deps.fail(e instanceof Error ? e.message : 'The background service did not start');
            deps.quit();
            return false;
        }
    );
    if (deps.smoke) {
        if (await machine) {
            deps.machineReady();
            await deps.smoke();
            deps.quit();
        }
        return;
    }
    const closeStorageMove = await deps.moveStorage();
    if (!stopped) {
        deps.restoreWindows();
    }
    // Only now: the last window closing quits the app on Linux.
    closeStorageMove();
    if (stopped) {
        return;
    }
    deps.startUpdater();
    if (await machine) {
        deps.machineReady();
    }
}

export interface SecretGate {
    open(): void;
    /* Settles only once the gate opened, so a window that opened early waits rather than hands the secret to an unproven daemon. */
    read(): Promise<string | null>;
}

export function createSecretGate(readSecret: () => Promise<string | null>): SecretGate {
    let open: () => void = () => undefined;
    const opened = new Promise<void>((resolve) => {
        open = resolve;
    });
    return {
        open: () => open(),
        read: async () => {
            await opened;
            return readSecret();
        }
    };
}
