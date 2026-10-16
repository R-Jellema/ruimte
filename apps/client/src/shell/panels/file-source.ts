import type { MachineResource } from '@/transport/machine-url';

/*
 * Where the bytes a binary renderer draws come from: a file on the machine, or one entry of an archive
 * there. An entry is read only: nothing about it can be revealed, renamed or saved over, and its version
 * is the archive's.
 */
export type FileSource = { kind: 'file'; path: string } | { kind: 'archive-entry'; path: string; entry: string; archiveMtime: number; archiveSize: number };

export function fileSource(path: string): FileSource {
    return { kind: 'file', path };
}

/* The machine's bytes for this source. `media` asks for ranges, which only a file has: an entry comes whole. */
export function machineResourceOf(source: FileSource, read: { mtime: number; size: number }, media = false): MachineResource {
    if (source.kind === 'archive-entry') {
        return { kind: 'archive-entry', path: source.path, entry: source.entry, mtime: source.archiveMtime, size: source.archiveSize };
    }
    return { kind: media ? 'media' : 'file', path: source.path, mtime: read.mtime, size: read.size };
}

/* What a file manager can be asked to show, which an entry inside an archive is not. */
export function revealablePath(source: FileSource): string | null {
    return source.kind === 'file' ? source.path : null;
}

/* One string per source and version, for a key or a reset that has to follow both. */
export function sourceKey(source: FileSource, read: { mtime: number; size: number }): string {
    return JSON.stringify(source.kind === 'file' ? [source.path, read.mtime, read.size] : [source.path, source.entry, source.archiveMtime, source.archiveSize]);
}
