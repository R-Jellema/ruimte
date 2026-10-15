import { readdir } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';

// Folders that hold dependencies or build output, never a project of a person's own.
const SKIPPED = new Set(['node_modules', 'target', 'vendor', 'dist', 'build', 'Pods']);

export type ReadDirectory = (folder: string) => Promise<{ name: string; directory: boolean }[]>;

const readDirectory: ReadDirectory = async (folder) =>
    (await readdir(folder, { withFileTypes: true })).map((entry) => ({ name: entry.name, directory: entry.isDirectory() }));

/*
 * The files called `name` in a folder and the folders below it, at most `depth` folders deep, without
 * hidden folders and the ones that hold dependencies or build output. Reads only, in a stable order.
 */
export async function findManifests(folder: string, name: string, depth: number, read: ReadDirectory = readDirectory): Promise<string[]> {
    const found: string[] = [];
    const visit = async (directory: string, left: number): Promise<void> => {
        let entries: { name: string; directory: boolean }[];
        try {
            entries = await read(directory);
        } catch {
            return;
        }
        if (entries.some((entry) => !entry.directory && entry.name === name)) {
            found.push(join(directory, name));
        }
        if (left === 0) {
            return;
        }
        const below = entries.filter((entry) => entry.directory && !entry.name.startsWith('.') && !SKIPPED.has(entry.name)).map((entry) => entry.name);
        for (const child of below.sort()) {
            await visit(join(directory, child), left - 1);
        }
    };
    await visit(folder, depth);
    return found;
}

/* The manifests that are no member of another one's folder: a workspace names its members itself. */
export function topmostManifests(paths: readonly string[]): string[] {
    const folders = paths.map((path) => dirname(path));
    return paths.filter((_, index) => !folders.some((other, at) => at !== index && folders[index]!.startsWith(`${other}${sep}`)));
}
