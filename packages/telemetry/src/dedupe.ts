/* Where the dedupe keeps what it sent: a file under the machine's home for the daemon, memory in a page. */
export interface DedupeStore {
    read(): Record<string, number>;
    write(entries: Record<string, number>): void;
}

export interface DailyDedupeOptions {
    readonly now?: () => number;
    readonly store?: DedupeStore;
    /* How many keys are remembered at most; the oldest go first. */
    readonly limit?: number;
}

export interface DailyDedupe {
    /* Whether an event may go out: false when one with the same key went out in the last day. Remembers it when it may. */
    admit(event: object): boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 200;
const TOP_FRAMES = 3;

export function memoryDedupeStore(): DedupeStore {
    let entries: Record<string, number> = {};
    return {
        read: () => ({ ...entries }),
        write: (next) => {
            entries = { ...next };
        }
    };
}

/* One report per error per day per installation, so a loop that throws costs one event and not thousands. */
export function createDailyDedupe(options: DailyDedupeOptions = {}): DailyDedupe {
    const now = options.now ?? Date.now;
    const store = options.store ?? memoryDedupeStore();
    const limit = options.limit ?? DEFAULT_LIMIT;
    return {
        admit(event) {
            const at = now();
            const key = eventKey(event);
            let entries: Record<string, number>;
            try {
                entries = store.read();
            } catch {
                entries = {};
            }
            const fresh = Object.entries(entries).filter(([, sentAt]) => typeof sentAt === 'number' && at - sentAt < DAY_MS && sentAt <= at);
            if (fresh.some(([seen]) => seen === key)) {
                return false;
            }
            fresh.push([key, at]);
            fresh.sort((first, second) => first[1] - second[1]);
            try {
                store.write(Object.fromEntries(fresh.slice(-limit)));
            } catch {
                // A store that cannot be written only costs a duplicate later.
            }
            return true;
        }
    };
}

/*
 * What makes two events the same error: the fingerprint the code gave it, or else the error's type,
 * its scrubbed message and the top frames of the app's own code. Hashed, so the store holds no text.
 */
export function eventKey(event: object): string {
    const source = event as {
        fingerprint?: unknown;
        message?: unknown;
        exception?: {
            values?: Array<{ type?: unknown; value?: unknown; stacktrace?: { frames?: Array<{ filename?: unknown; function?: unknown; in_app?: unknown }> } }>;
        };
    };
    if (Array.isArray(source.fingerprint) && source.fingerprint.length > 0 && !source.fingerprint.includes('{{ default }}')) {
        return hash(source.fingerprint.map(String).join('\u0000'));
    }
    const exception = source.exception?.values?.at(-1);
    const frames = (exception?.stacktrace?.frames ?? [])
        .filter((frame) => frame.in_app !== false)
        .slice(-TOP_FRAMES)
        .map((frame) => `${String(frame.filename ?? '')}:${String(frame.function ?? '')}`);
    return hash([String(exception?.type ?? ''), String(exception?.value ?? source.message ?? ''), ...frames].join('\u0000'));
}

/* FNV-1a, 32 bits: short, the same in every runtime, and needs no crypto module in a page. */
function hash(text: string): string {
    let value = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        value ^= text.charCodeAt(i);
        value = Math.imul(value, 0x01000193);
    }
    return (value >>> 0).toString(16).padStart(8, '0');
}
