import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileExists } from '@adecore/agents';
import { sha256 } from '../artifacts/artifact-fs.ts';
import type { LanguageRuntime, RunCommand } from './runtime.ts';

const SETS = 'packages';
const STAGING = '.staging';
const SET_FILE = 'set.json';
const SET_NAME = 'ruimte-language-packages';
/* A set id is 16 hex digits; anything else in the folder is not Ruimte's to remove. */
const SET_ID = /^[0-9a-f]{16}$/;

export interface PackageStoreOptions {
    /* `$RUIMTE_HOME/language-servers`. */
    root: string;
    runtime: LanguageRuntime;
    run: RunCommand;
    now: () => number;
    platform?: string;
    arch?: string;
}

/* `set.json`: what a set was installed from, written last so a set without it was never finished. */
export interface PackageSetRecord {
    format: 1;
    dependencies: Record<string, string>;
    platform: string;
    arch: string;
    installedAt: number;
    files: number;
    bytes: number;
}

/* A hold on a set: while it is out, `collect` leaves the set alone. */
export interface Lease {
    readonly setId: string;
    /* The folder of the set, with its `package.json`, `bun.lock`, `node_modules` and `set.json`. */
    readonly folder: string;
    release(): void;
}

/*
 * Immutable package sets under `language-servers/packages/<setId>`: one `bun install` result, identified by
 * what it pins plus platform, shared by every install that pins the same. A set is built in a staging folder
 * on the same file system and published with one rename, so it is whole or absent. A set is never written
 * after it is published; the installs only link to it.
 */
export class PackageStore {
    private readonly options: PackageStoreOptions;
    private readonly platform: string;
    private readonly arch: string;
    private readonly leases = new Map<string, number>();
    private readonly building = new Map<string, Promise<void>>();
    /* Serializes the check of a set against a collection, so `collect` never removes a set that `ensure` is about to hand out. */
    private tail: Promise<unknown> = Promise.resolve();

    constructor(options: PackageStoreOptions) {
        this.options = options;
        this.platform = options.platform ?? process.platform;
        this.arch = options.arch ?? process.arch;
    }

    /* `language-servers/packages`. */
    get directory(): string {
        return join(this.options.root, SETS);
    }

    /* The id of the set that holds these dependencies on this platform; the kind is no part of it. */
    setIdOf(dependencies: Record<string, string>): string {
        const entries = Object.entries(dependencies).sort(([left], [right]) => left.localeCompare(right));
        return sha256(JSON.stringify({ deps: entries, platform: this.platform, arch: this.arch })).slice(0, 16);
    }

    folderOf(setId: string): string {
        return join(this.directory, setId);
    }

    /*
     * Hands out the set of these dependencies, building it when it is absent or does not hold every entry the
     * caller needs (paths below `node_modules`). Callers asking for the same set while it builds share the build.
     */
    async ensure(dependencies: Record<string, string>, entries: readonly string[], log: (line: string) => void): Promise<Lease> {
        const setId = this.setIdOf(dependencies);
        // The lease is taken before anything is awaited, so a collection that runs meanwhile sees it.
        const lease = this.lease(setId);

        try {
            if (!(await this.exclusive(() => this.isWhole(setId, entries)))) {
                let build = this.building.get(setId);

                if (build === undefined) {
                    build = this.build(setId, dependencies, entries, log).finally(() => this.building.delete(setId));
                    this.building.set(setId, build);
                }

                await build;

                if (!(await this.isWhole(setId, entries))) {
                    throw new Error(`The package set ${setId} does not hold every package this server needs`);
                }
            }

            return lease;
        } catch (error) {
            lease.release();
            throw error;
        }
    }

    /*
     * Removes the sets that no install refers to and no lease holds. `references` returns the ids in use, or
     * null when the disk could not be read in full, and then nothing is removed.
     */
    collect(references: () => Promise<Set<string> | null>): Promise<string[]> {
        return this.exclusive(async () => {
            const used = await references();

            if (used === null) {
                return [];
            }

            const removed: string[] = [];

            const present = (await readdir(this.directory).catch(() => [] as string[])).sort();

            for (const setId of present) {
                if (!SET_ID.test(setId) || used.has(setId) || this.leases.has(setId) || this.building.has(setId)) {
                    continue;
                }

                // Moved out of the way first, so a crash in the middle of `rm` leaves staging and not a half set under its id.
                const trash = join(this.directory, STAGING, `removed-${setId}-${randomUUID().slice(0, 8)}`);

                await mkdir(join(this.directory, STAGING), { recursive: true });
                await rename(this.folderOf(setId), trash);
                await rm(trash, { recursive: true, force: true });
                removed.push(setId);
            }

            return removed;
        });
    }

    /* Clears what an interrupted install left in staging. A set is never in staging once published, so nothing there is worth keeping. */
    async recover(): Promise<void> {
        await rm(join(this.directory, STAGING), { recursive: true, force: true });
    }

    async readRecord(setId: string): Promise<PackageSetRecord | null> {
        try {
            return JSON.parse(await readFile(join(this.folderOf(setId), SET_FILE), 'utf8')) as PackageSetRecord;
        } catch {
            return null;
        }
    }

    private lease(setId: string): Lease {
        this.leases.set(setId, (this.leases.get(setId) ?? 0) + 1);
        let released = false;

        return {
            setId,
            folder: this.folderOf(setId),
            release: () => {
                if (released) {
                    return;
                }

                released = true;
                const left = (this.leases.get(setId) ?? 1) - 1;

                if (left <= 0) {
                    this.leases.delete(setId);
                } else {
                    this.leases.set(setId, left);
                }
            }
        };
    }

    private exclusive<T>(work: () => Promise<T>): Promise<T> {
        const result = this.tail.then(work, work);
        this.tail = result.catch(() => undefined);

        return result;
    }

    private async isWhole(setId: string, entries: readonly string[]): Promise<boolean> {
        const folder = this.folderOf(setId);

        if (!(await fileExists(join(folder, SET_FILE)))) {
            return false;
        }

        return (await Promise.all(entries.map((entry) => fileExists(join(folder, 'node_modules', entry))))).every(Boolean);
    }

    private async build(setId: string, dependencies: Record<string, string>, entries: readonly string[], log: (line: string) => void): Promise<void> {
        const staging = join(this.directory, STAGING, `${setId}-${randomUUID().slice(0, 8)}`);

        try {
            await mkdir(staging, { recursive: true });
            await writeFile(join(staging, 'package.json'), `${JSON.stringify({ name: SET_NAME, private: true, dependencies }, null, 2)}\n`);
            log(
                `Installing ${Object.entries(dependencies)
                    .map(([name, version]) => `${name}@${version}`)
                    .join(', ')}`
            );

            const { runtime } = this.options;
            const code = await this.options.run(
                { command: runtime.command, args: [...runtime.args, 'install', '--ignore-scripts'], cwd: staging, env: runtime.env },
                log
            );

            if (code !== 0) {
                throw new Error(`The installer exited with code ${code}`);
            }

            for (const entry of entries) {
                if (!(await fileExists(join(staging, 'node_modules', entry)))) {
                    throw new Error(`The install did not leave ${join(this.folderOf(setId), 'node_modules', entry)}`);
                }
            }

            const { files, bytes } = await measure(join(staging, 'node_modules'));
            const record: PackageSetRecord = {
                format: 1,
                dependencies,
                platform: this.platform,
                arch: this.arch,
                installedAt: this.options.now(),
                files,
                bytes
            };

            await writeFile(join(staging, SET_FILE), `${JSON.stringify(record)}\n`);
            await this.publish(setId, staging, entries);
        } finally {
            await rm(staging, { recursive: true, force: true });
        }
    }

    /* One rename makes the set appear. A set that is already there was published by another daemon or an earlier run, and is used when it is whole. */
    private async publish(setId: string, staging: string, entries: readonly string[]): Promise<void> {
        const target = this.folderOf(setId);

        for (const attempt of [0, 1]) {
            try {
                await rename(staging, target);

                return;
            } catch (error) {
                const code = (error as NodeJS.ErrnoException).code;

                if (code !== 'EEXIST' && code !== 'ENOTEMPTY') {
                    throw error;
                }

                if (await this.isWhole(setId, entries)) {
                    return;
                }

                if (attempt === 1) {
                    throw error;
                }

                // A folder under the id that is not whole was never published by this store; it is replaced.
                await rm(target, { recursive: true, force: true });
            }
        }
    }
}

/* The files below a folder and their size, with links counted as entries and not followed. */
async function measure(folder: string): Promise<{ files: number; bytes: number }> {
    let files = 0;
    let bytes = 0;

    for (const entry of await readdir(folder, { withFileTypes: true, recursive: true })) {
        if (entry.isDirectory()) {
            continue;
        }

        files++;

        if (entry.isFile()) {
            bytes += (await lstat(join(entry.parentPath, entry.name))).size;
        }
    }

    return { files, bytes };
}
