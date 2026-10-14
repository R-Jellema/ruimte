import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import type { ChatItem } from '@ruimte/contracts';
import { toolWrites } from '../provenance/tool-writes.ts';

export interface WorkedFolder {
    path: string;
    /* Distinct paths the chat wrote or read in it. */
    files: number;
}

export interface WorkedFolderOptions {
    /* The chat's own folder in Chats, which also resolves a relative path. */
    cwd: string;
    home: string;
    ruimteHome: string;
    /* The top of the checkout a folder is in, or null. The path may no longer exist. */
    gitRoot(directory: string): Promise<string | null>;
}

// Tools of the CLIs that name a path they only look at; Claude's names, which the Apple backend shares.
const READ_PATH_FIELDS: Record<string, readonly string[]> = {
    Read: ['file_path'],
    Glob: ['path'],
    Grep: ['path'],
    LS: ['path'],
    NotebookRead: ['notebook_path']
};

function isUnder(parent: string, path: string): boolean {
    const between = relative(parent, path);
    return between === '' || (!between.startsWith('..') && !isAbsolute(between));
}

function readPaths(item: Extract<ChatItem, { kind: 'tool' }>, cwd: string): string[] {
    const input = typeof item.input === 'object' && item.input !== null ? (item.input as Record<string, unknown>) : {};
    return (READ_PATH_FIELDS[item.name] ?? []).flatMap((field) => {
        const value = input[field];
        return typeof value === 'string' && value !== '' ? [resolve(cwd, value)] : [];
    });
}

/* The paths the finished tool calls of a thread touched, each once, in the order they first came up. */
function touchedPaths(items: readonly ChatItem[], cwd: string): string[] {
    const paths = new Set<string>();
    for (const item of items) {
        if (item.kind !== 'tool' || item.state !== 'done') {
            continue;
        }
        for (const write of toolWrites(item, cwd)) {
            paths.add(write.path);
        }
        for (const path of readPaths(item, cwd)) {
            paths.add(path);
        }
    }
    return [...paths];
}

/* The first folder below home that holds the path; null for a file straight in home. */
function topUnderHome(home: string, path: string): string | null {
    const [first, ...rest] = relative(home, path).split(sep);
    return first !== undefined && first !== '' && rest.length > 0 ? join(home, first) : null;
}

/*
 * The folders a chat worked in, most touched first. A path rounds up to the checkout it is in, or
 * else to the first folder below home; home itself and anything under the chat's own folder or the
 * machine's data folder never counts.
 */
export async function workedFolders(items: readonly ChatItem[], options: WorkedFolderOptions): Promise<WorkedFolder[]> {
    const { cwd, home, ruimteHome, gitRoot } = options;
    const roots = new Map<string, Promise<string | null>>();
    const rootOf = (directory: string): Promise<string | null> => {
        let found = roots.get(directory);
        if (found === undefined) {
            found = gitRoot(directory);
            roots.set(directory, found);
        }
        return found;
    };

    const counts = new Map<string, number>();
    for (const path of touchedPaths(items, cwd)) {
        if (isUnder(cwd, path) || isUnder(ruimteHome, path)) {
            continue;
        }
        const root = await rootOf(dirname(path));
        let folder: string | null;
        if (root !== null && !isUnder(root, home)) {
            folder = root;
        } else if (isUnder(home, path)) {
            folder = topUnderHome(home, path);
        } else {
            folder = dirname(path);
        }
        if (folder === null || folder === home || folder === parse(folder).root || isUnder(ruimteHome, folder)) {
            continue;
        }
        counts.set(folder, (counts.get(folder) ?? 0) + 1);
    }
    return [...counts].map(([path, files]) => ({ path, files })).sort((a, b) => b.files - a.files);
}
