import { cp, lstat, mkdir, readdir, rm, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ChatError } from '../chat/errors.ts';
import { errorText } from '../error-text.ts';
import { renameNoReplace } from '../fs/no-replace-rename.ts';

export interface MovedOwnFiles {
    /* The top-level names that arrived in the target. */
    moved: string[];
    /* Puts every name back, last first; a second call does nothing. */
    undo(): Promise<void>;
}

export interface OwnFilesIO {
    /* Moves one path without replacing anything; fails with `EEXIST` when the target is taken. */
    rename(from: string, to: string): Promise<void>;
    copy(from: string, to: string): Promise<void>;
}

const SYSTEM_IO: OwnFilesIO = {
    rename: renameNoReplace,
    // `force: false` with `errorOnExist` makes the copy refuse a name that is taken, as the rename does.
    copy: (from, to) => cp(from, to, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true, preserveTimestamps: true })
};

function codeOf(error: unknown): string | undefined {
    return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
}

function isTaken(error: unknown): boolean {
    const code = codeOf(error);
    return code === 'EEXIST' || code === 'ERR_FS_CP_EEXIST';
}

async function exists(path: string): Promise<boolean> {
    return (await lstat(path).catch(() => null)) !== null;
}

/* One entry back to where it came from: a rename, else (another volume) a copy and then the delete. */
async function moveBack(io: OwnFilesIO, from: string, to: string): Promise<void> {
    try {
        await io.rename(from, to);
    } catch (e) {
        if (codeOf(e) !== 'EXDEV') {
            throw e;
        }
        await io.copy(from, to);
        await rm(from, { recursive: true, force: true });
    }
}

/*
 * Moves the top-level entries of a chat's own folder, hidden ones included, into another folder
 * without replacing anything. A name already there refuses with `files-conflict` before the first
 * entry moves. Across a volume the entries are copied first and the originals deleted only after
 * every copy succeeded; a failed copy removes only what this call made. The emptied `from` goes with
 * `rmdir`, never recursively.
 */
export async function moveOwnFiles(from: string, to: string, io: OwnFilesIO = SYSTEM_IO): Promise<MovedOwnFiles> {
    const names = await readdir(from).catch((e: unknown) => {
        if (codeOf(e) === 'ENOENT') {
            return [];
        }
        throw new ChatError('move-failed', `The folder ${from} could not be read: ${errorText(e)}`);
    });
    names.sort();
    for (const name of names) {
        if (await exists(join(to, name))) {
            throw new ChatError('files-conflict', `${name} is already in ${to}`);
        }
    }

    const arrived: string[] = [];
    let removedFolder = false;
    let undone = false;
    const undo = async (): Promise<void> => {
        if (undone) {
            return;
        }
        undone = true;
        let failure: unknown = null;
        if (removedFolder) {
            await mkdir(from, { recursive: true }).catch((e: unknown) => (failure ??= e));
        }
        for (const name of arrived.toReversed()) {
            try {
                await moveBack(io, join(to, name), join(from, name));
            } catch (e) {
                failure ??= e;
            }
        }
        if (failure !== null) {
            throw new ChatError('move-failed', `The files could not be put back in ${from}: ${errorText(failure)}`);
        }
    };

    const failed = async (e: unknown, name: string): Promise<never> => {
        await undo().catch(() => undefined);
        if (isTaken(e)) {
            throw new ChatError('files-conflict', `${name} is already in ${to}`);
        }
        throw new ChatError('move-failed', `${name} could not be moved to ${to}: ${errorText(e)}`);
    };

    let crossing = names.length;
    for (const [i, name] of names.entries()) {
        try {
            await io.rename(join(from, name), join(to, name));
            arrived.push(name);
        } catch (e) {
            if (codeOf(e) !== 'EXDEV') {
                return failed(e, name);
            }
            crossing = i;
            break;
        }
    }

    const copies = names.slice(crossing);
    const copied: string[] = [];
    for (const name of copies) {
        try {
            await io.copy(join(from, name), join(to, name));
            copied.push(name);
        } catch (e) {
            // A name that turned out to be taken is not ours to remove.
            for (const made of isTaken(e) ? copied : [...copied, name]) {
                await rm(join(to, made), { recursive: true, force: true }).catch(() => undefined);
            }
            return failed(e, name);
        }
    }
    for (const [i, name] of copied.entries()) {
        try {
            await rm(join(from, name), { recursive: true, force: true });
        } catch (e) {
            // The originals before this one are gone and come back from their copies; those after it are still whole, and so is the copy of this one.
            arrived.push(...copied.slice(0, i));
            for (const later of copied.slice(i + 1)) {
                await rm(join(to, later), { recursive: true, force: true }).catch(() => undefined);
            }
            return failed(e, name);
        }
    }
    arrived.push(...copied);

    removedFolder = await rmdir(from).then(
        () => true,
        () => false
    );
    return { moved: names, undo };
}
