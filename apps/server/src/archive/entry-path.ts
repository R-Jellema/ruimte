import { ARCHIVE_ENTRY_PATH_MAX } from '@ruimte/contracts';

const DRIVE = /^[a-zA-Z]:/;

/*
 * An entry's name as a relative path with `/` between its parts, or null when it could land outside
 * the folder it is extracted into: an absolute name, a drive letter, a `..` anywhere, a NUL, or nothing
 * left at all. A backslash is a separator, since an archive made on Windows writes one and a machine
 * that reads it as a letter would still hand it to a file system that does not.
 */
export function safeEntryPath(raw: string): string | null {
    if (raw.length === 0 || raw.length > ARCHIVE_ENTRY_PATH_MAX || raw.includes('\0')) {
        return null;
    }
    const slashed = raw.replaceAll('\\', '/');
    if (slashed.startsWith('/') || DRIVE.test(slashed)) {
        return null;
    }
    const parts: string[] = [];
    for (const part of slashed.split('/')) {
        if (part === '' || part === '.') {
            continue;
        }
        if (part === '..') {
            return null;
        }
        parts.push(part);
    }
    return parts.length === 0 ? null : parts.join('/');
}

/* Whether a person's pick of `selected` takes `path`: the entry itself, or everything under a folder. */
export function selects(selected: string, path: string): boolean {
    return path === selected || path.startsWith(`${selected}/`);
}

/* Whether the name is the archive's own top folder, `.` or `./`, which tar writes first and which holds nothing to list. */
export function namesTop(raw: string): boolean {
    return /^\.(?:[/\\]+\.?)*[/\\]*$/.test(raw);
}
