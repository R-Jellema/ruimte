import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DedupeStore } from './dedupe.ts';

/* A dedupe store in a file only its owner reads, in a folder no page reaches. Its own entry point keeps `node:fs` out of the page. */
export function fileDedupeStore(path: string): DedupeStore {
    return {
        read: () => {
            const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
            return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, number>) : {};
        },
        write: (entries) => {
            mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
            writeFileSync(path, JSON.stringify(entries), { mode: 0o600 });
        }
    };
}
