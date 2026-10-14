import type { z } from 'zod';

export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/* Read again on every call, so a test that swaps the global meets the store that reads it. */
export function browserStorage(): KeyValueStorage | null {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
        return null;
    }
}

export interface StoredValue<Value, Stored = Value> {
    /* Null when nothing is stored, the storage refuses, or what is stored does not fit. */
    read(storage?: Pick<Storage, 'getItem'> | null): Value | null;
    /* False when the storage refused it, which keeps the value for this session only. */
    write(value: Stored, storage?: Pick<Storage, 'setItem'> | null): boolean;
    remove(storage?: Pick<Storage, 'removeItem'> | null): void;
}

/*
 * One key of the browser's storage as JSON, read through a schema. A schema may be lenient on purpose
 * (dropping the entries that do not fit), since what a person saved under an older version is kept.
 */
export function storedJson<Value, Stored = Value>(key: string, schema: z.ZodType<Value, unknown>): StoredValue<Value, Stored> {
    return {
        read(storage = browserStorage()) {
            try {
                const raw = storage?.getItem(key) ?? null;
                if (raw === null) {
                    return null;
                }
                const parsed = schema.safeParse(JSON.parse(raw));
                return parsed.success ? parsed.data : null;
            } catch {
                return null;
            }
        },
        write(value, storage = browserStorage()) {
            return writeRaw(storage, key, JSON.stringify(value));
        },
        remove(storage = browserStorage()) {
            removeRaw(storage, key);
        }
    };
}

/* One key that holds a bare string, as the ones written before a key was JSON still do. */
export function storedText(key: string): StoredValue<string> {
    return {
        read(storage = browserStorage()) {
            try {
                return storage?.getItem(key) ?? null;
            } catch {
                return null;
            }
        },
        write(value, storage = browserStorage()) {
            return writeRaw(storage, key, value);
        },
        remove(storage = browserStorage()) {
            removeRaw(storage, key);
        }
    };
}

function writeRaw(storage: Pick<Storage, 'setItem'> | null, key: string, raw: string): boolean {
    if (storage === null) {
        return false;
    }
    try {
        storage.setItem(key, raw);
        return true;
    } catch {
        return false;
    }
}

function removeRaw(storage: Pick<Storage, 'removeItem'> | null, key: string): void {
    try {
        storage?.removeItem(key);
    } catch {
        // A key that cannot be removed is read again at the next start, which is all it costs.
    }
}
