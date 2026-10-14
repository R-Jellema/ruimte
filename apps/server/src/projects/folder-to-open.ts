import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { ProjectError } from './project-error.ts';

/*
 * The folder a person named to open, as this machine knows it. `~` is this machine's home, whoever
 * typed it, and a relative path is refused: the daemon's own working folder means nothing to them.
 */
export function folderToOpen(folder: string, home: string = homedir()): string {
    const trimmed = folder.trim();
    if (trimmed === '~' || trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
        return resolve(join(home, trimmed.slice(1)));
    }
    if (!isAbsolute(trimmed)) {
        throw new ProjectError('folder-not-found', `${trimmed} is not a full path; start it at the root or at ~`);
    }
    return resolve(trimmed);
}
