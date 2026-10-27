import { lstat, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

/*
 * What the language servers take on disk, read-only: logical bytes (the sizes of every file), allocated
 * bytes (`st_blocks * 512`, each inode once, so a hardlink or a shared set counts a single time) and the
 * number of entries, per folder below the language servers folder and in total. Links are counted as
 * entries and never followed, so a package set is measured under `packages` and not again through an
 * install that links to it. Run it before and after the first start that adopts the installs.
 *
 *   bun apps/server/scripts/measure-language-storage.ts [folder]
 *
 * The folder defaults to `$RUIMTE_HOME/language-servers` (`~/.ruimte` when unset).
 */
const { positionals } = parseArgs({ args: process.argv.slice(2), allowPositionals: true, strict: true });

interface Totals {
    logical: number;
    allocated: number;
    entries: number;
    files: number;
}

const root = resolve(positionals[0] ?? join(process.env.RUIMTE_HOME ?? join(homedir(), '.ruimte'), 'language-servers'));
const seen = new Set<string>();

function mebibytes(bytes: number): string {
    return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

async function measure(folder: string, totals: Totals): Promise<void> {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
        const path = join(folder, entry.name);
        const stat = await lstat(path);

        totals.entries++;

        if (stat.isDirectory()) {
            await measure(path, totals);

            continue;
        }

        if (stat.isFile()) {
            totals.files++;
            totals.logical += stat.size;
        }

        // A link takes an inode of its own, a hardlinked file only the one.
        const key = `${stat.dev}:${stat.ino}`;

        if (!seen.has(key)) {
            seen.add(key);
            totals.allocated += stat.blocks * 512;
        }
    }
}

function line(name: string, totals: Totals): string {
    return `${name.padEnd(16)} ${mebibytes(totals.logical).padStart(11)} logical ${mebibytes(totals.allocated).padStart(11)} allocated ${String(totals.entries).padStart(7)} entries ${String(totals.files).padStart(7)} files`;
}

const total: Totals = { logical: 0, allocated: 0, entries: 0, files: 0 };

console.log(`Measuring ${root}`);

for (const name of (await readdir(root)).sort()) {
    const path = join(root, name);

    if (!(await lstat(path)).isDirectory()) {
        continue;
    }

    const part: Totals = { logical: 0, allocated: 0, entries: 0, files: 0 };

    await measure(path, part);
    console.log(line(name, part));

    for (const key of Object.keys(total) as (keyof Totals)[]) {
        total[key] += part[key];
    }
}

console.log(line('total', total));
