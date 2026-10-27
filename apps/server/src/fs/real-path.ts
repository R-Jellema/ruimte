import { realpath } from 'node:fs/promises';

/* The path with its symlinks resolved, or the path itself when it does not exist. */
export function realOrSelf(path: string): Promise<string> {
    return realpath(path).catch(() => path);
}

/* The path with its symlinks resolved, or null when it does not exist. */
export function realOrNull(path: string): Promise<string | null> {
    return realpath(path).catch(() => null);
}
