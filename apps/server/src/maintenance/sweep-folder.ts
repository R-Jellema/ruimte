import { lstat, opendir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Reclaimed } from './maintenance.ts';

/* Enough for any folder a sweep reaches here, and a bound on one pass for a folder that grew past all reason. */
const MAX_ENTRIES = 5000;
const MAX_REMOVED = 1000;

interface SweepFolderOptions {
    /* Whether a file is past its age, from its name or from what `lstat` read just before the removal. */
    expired(name: string, modifiedMs: number): boolean;
    signal?: AbortSignal;
}

/*
 * Removes the files directly in `folder` that `expired` names, never a folder below it or a link. Each
 * is read again just before it goes, so a file a writer replaced in the meantime is judged as it is now.
 */
export async function sweepFolder(folder: string, options: SweepFolderOptions): Promise<Reclaimed> {
    const reclaimed: Reclaimed = { files: 0, bytes: 0 };
    let directory;
    try {
        directory = await opendir(folder);
    } catch {
        return reclaimed;
    }
    let seen = 0;
    for await (const entry of directory) {
        seen += 1;
        if (options.signal?.aborted || seen > MAX_ENTRIES || reclaimed.files >= MAX_REMOVED) {
            break;
        }
        if (!entry.isFile()) {
            continue;
        }
        const path = join(folder, entry.name);
        const stats = await lstat(path).catch(() => null);
        if (stats === null || !stats.isFile() || !options.expired(entry.name, stats.mtimeMs)) {
            continue;
        }
        const removed = await rm(path).then(
            () => true,
            () => false
        );
        if (removed) {
            reclaimed.files += 1;
            reclaimed.bytes += stats.size;
        }
    }
    return reclaimed;
}
