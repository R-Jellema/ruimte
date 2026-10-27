import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PhpCache } from './host.ts';
import { planEviction, probeRoot, sweepPhpCache, type CacheEntry, type CacheOwner, type EvictionInput, type Probe, type Sightings } from './php-cache.ts';
import { StorageGate } from './storage-gate.ts';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY;
const STUBS_ROOT = '/home/php-native/storage/stubs';

function entry(name: string, size = 10, mtimeMs = 0): CacheEntry {
    return { name, size, mtimeMs };
}

function project(key: string, path: string, overrides: Partial<CacheOwner> = {}): CacheOwner {
    return {
        manifest: `owner-${key}.json`,
        kind: 'project',
        path,
        folder: path,
        files: [`project-${key}.bin`, `words-${key}.bin`],
        lastUsedMs: 0,
        ...overrides
    };
}

function filesOf(...keys: string[]): CacheEntry[] {
    return keys.flatMap((key) => [entry(`owner-${key}.json`, 1), entry(`project-${key}.bin`), entry(`words-${key}.bin`)]);
}

function plan(overrides: Partial<EvictionInput>) {
    return planEviction({
        entries: [],
        owners: [],
        unreadableOwner: false,
        live: { folders: [], stubsDirs: [], anyProcess: false },
        knownFolders: [],
        probes: {},
        sightings: {},
        stubsRoot: STUBS_ROOT,
        keptStubs: [],
        now: NOW,
        budget: 1_000_000,
        ...overrides
    });
}

function removed(result: ReturnType<typeof plan>): string[] {
    return result.remove.flatMap((group) => [...group.files, ...(group.manifest === null ? [] : [group.manifest])]).sort();
}

describe('planEviction', () => {
    it('keeps the owner of a live folder and of a root inside one, even far over budget', () => {
        const result = plan({
            entries: filesOf('a', 'b', 'c'),
            owners: [project('a', '/work/app'), project('b', '/work/app/packages/api', { folder: '/work/app' }), project('c', '/other')],
            live: { folders: ['/work/app'], stubsDirs: [], anyProcess: true },
            budget: 0
        });

        expect(removed(result)).toEqual(['owner-c.json', 'project-c.bin', 'words-c.bin']);
    });

    it('leaves a file no manifest names alone while any server runs, and evicts it by age once none does', () => {
        const entries = [entry('project-old.bin', 10, 1), entry('project-new.bin', 10, 2)];

        expect(removed(plan({ entries, live: { folders: [], stubsDirs: [], anyProcess: true }, budget: 0 }))).toEqual([]);
        expect(removed(plan({ entries, budget: 10 }))).toEqual(['project-old.bin']);
    });

    it('touches nothing when a manifest is of a format it does not know', () => {
        const result = plan({
            entries: [...filesOf('a'), entry('stray.bin'), entry('x.tmp')],
            owners: [project('a', '/gone')],
            unreadableOwner: true,
            probes: { '/gone': 'missing' },
            sightings: { '/gone': { firstMs: 0, lastMs: NOW - 1, count: 9 } },
            budget: 0
        });

        expect(result.remove).toEqual([]);
    });

    it('stops evicting the least recently used owners as soon as the budget holds', () => {
        const result = plan({
            entries: filesOf('a', 'b', 'c'),
            owners: [project('a', '/a', { lastUsedMs: 3 }), project('b', '/b', { lastUsedMs: 1 }), project('c', '/c', { lastUsedMs: 2 })],
            budget: 61
        });

        expect(removed(result)).toEqual(['owner-b.json', 'project-b.bin', 'words-b.bin']);
    });

    it('mixes owners and unowned files by their last use', () => {
        const result = plan({
            entries: [...filesOf('a'), entry('project-stray.bin', 21, 1)],
            owners: [project('a', '/a', { lastUsedMs: 5 })],
            budget: 21
        });

        expect(removed(result)).toEqual(['project-stray.bin']);
    });

    it('removes the owners of stubs that Install pruned, and keeps those it kept or that still exist', () => {
        const stub = (commit: string): CacheOwner => ({
            manifest: `owner-stubs-${commit}.json`,
            kind: 'stubs',
            path: `${STUBS_ROOT}/${commit}`,
            folder: `${STUBS_ROOT}/${commit}`,
            files: [`stubs-${commit}.bin`],
            lastUsedMs: 0
        });
        const result = plan({
            entries: [
                entry('owner-stubs-old.json', 1),
                entry('stubs-old.bin'),
                entry('owner-stubs-kept.json', 1),
                entry('stubs-kept.bin'),
                entry('owner-stubs-here.json', 1)
            ],
            owners: [stub('old'), stub('kept'), stub('here')],
            keptStubs: ['kept'],
            probes: { [`${STUBS_ROOT}/old`]: 'missing', [`${STUBS_ROOT}/kept`]: 'missing', [`${STUBS_ROOT}/here`]: 'present' }
        });

        expect(removed(result)).toEqual(['owner-stubs-old.json', 'stubs-old.bin']);
    });

    it('removes abandoned temporary files only while no server runs', () => {
        const entries = [entry('project-a.bin.tmp'), entry('owner-a.json.partial')];

        expect(removed(plan({ entries }))).toEqual(['owner-a.json.partial', 'project-a.bin.tmp']);
        expect(removed(plan({ entries, live: { folders: [], stubsDirs: [], anyProcess: true } }))).toEqual([]);
    });

    describe('a checkout that vanished', () => {
        const owner = project('a', '/work/gone');
        const entries = filesOf('a');
        const seen: Sightings = { '/work/gone': { firstMs: NOW - 8 * DAY, lastMs: NOW - DAY, count: 5 } };

        it('goes with its manifest after three sightings over seven days', () => {
            const result = plan({ entries, owners: [owner], probes: { '/work/gone': 'missing' }, sightings: seen });

            expect(removed(result)).toEqual(['owner-a.json', 'project-a.bin', 'words-a.bin']);
            expect(result.remove[0]!.manifest).toBe('owner-a.json');
            expect(result.sightings['/work/gone']).toEqual({ firstMs: NOW - 8 * DAY, lastMs: NOW, count: 6 });
        });

        it('first records a sighting and removes nothing', () => {
            const result = plan({ entries, owners: [owner], probes: { '/work/gone': 'missing' } });

            expect(result.remove).toEqual([]);
            expect(result.sightings['/work/gone']).toEqual({ firstMs: NOW, lastMs: NOW, count: 1 });
        });

        it('needs both the count and the span', () => {
            const few = { '/work/gone': { firstMs: NOW - 8 * DAY, lastMs: NOW - DAY, count: 1 } };
            const short = { '/work/gone': { firstMs: NOW - 2 * DAY, lastMs: NOW - DAY, count: 9 } };

            expect(plan({ entries, owners: [owner], probes: { '/work/gone': 'missing' }, sightings: few }).remove).toEqual([]);
            expect(plan({ entries, owners: [owner], probes: { '/work/gone': 'missing' }, sightings: short }).remove).toEqual([]);
        });

        it.each<Probe>(['present', 'unknown'])('forgets its sightings when the probe says %s', (probe) => {
            const result = plan({ entries, owners: [owner], probes: { '/work/gone': probe }, sightings: seen });

            expect(result.remove).toEqual([]);
            expect(result.sightings).toEqual({});
        });

        it('stays while a known project folder is it, holds it or lies inside it', () => {
            for (const known of ['/work/gone', '/work', '/work/gone/sub']) {
                const result = plan({ entries, owners: [owner], probes: { '/work/gone': 'missing' }, sightings: seen, knownFolders: [known] });

                expect(result.remove).toEqual([]);
            }
        });

        it('stays while a server of its folder runs', () => {
            const result = plan({
                entries,
                owners: [owner],
                probes: { '/work/gone': 'missing' },
                sightings: seen,
                live: { folders: ['/work/gone'], stubsDirs: [], anyProcess: true }
            });

            expect(result.remove).toEqual([]);
        });
    });

    it('removes the manifest of an owner whose files are all gone', () => {
        const result = plan({ entries: [entry('owner-a.json', 1)], owners: [project('a', '/work/app')], probes: { '/work/app': 'present' } });

        expect(removed(result)).toEqual(['owner-a.json']);
    });
});

describe('probeRoot', () => {
    const roots: string[] = [];

    afterEach(async () => {
        await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
    });

    async function home(): Promise<string> {
        const root = await mkdtemp(join(tmpdir(), 'ruimte-probe-'));
        roots.push(root);

        return root;
    }

    it('tells present, missing and unknown apart', async () => {
        const root = await home();
        await writeFile(join(root, 'file'), '');

        expect(await probeRoot(root)).toBe('present');
        expect(await probeRoot(join(root, 'gone'))).toBe('missing');
        expect(await probeRoot(join(root, 'file', 'below'))).toBe('unknown');
        expect(await probeRoot(join(root, 'gone', 'deeper'))).toBe('unknown');
    });

    it('answers unknown when the look outlasts its timeout', async () => {
        const root = await home();
        let fire = (): void => undefined;
        const timers = {
            set: (run: () => void) => {
                fire = run;

                return () => undefined;
            }
        };
        const pending = probeRoot(join(root, 'gone'), timers, 1);
        fire();

        expect(await pending).toBe('unknown');
    });
});

describe('sweepPhpCache', () => {
    const roots: string[] = [];

    afterEach(async () => {
        await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
    });

    async function rig(live: { folders?: string[]; any?: boolean } = {}) {
        const root = await mkdtemp(join(tmpdir(), 'ruimte-php-cache-'));
        roots.push(root);
        const storage = join(root, 'php-native', 'storage');
        const cache = join(storage, 'cache');
        await mkdir(cache, { recursive: true });
        const gate = new StorageGate();

        const php: PhpCache = {
            storage,
            keptStubs: [],
            liveFolders: () => live.folders ?? [],
            liveStubsDirs: () => [],
            anyLive: () => live.any ?? false,
            hold: (work) => gate.hold(work)
        };

        const write = async (name: string, text = 'x'.repeat(10)): Promise<void> => {
            await writeFile(join(cache, name), text);
        };

        const manifest = async (key: string, path: string): Promise<void> => {
            const owner = { format: 1, kind: 'project', path, folder: path, files: [`project-${key}.bin`, `words-${key}.bin`], lastUsedMs: 0, server: '0.8.0' };
            await write(`owner-${key}.json`, JSON.stringify(owner));
            await write(`project-${key}.bin`);
            await write(`words-${key}.bin`);
        };

        return { php, cache, root, gate, write, manifest, sightingsFile: join(root, 'php-native', 'cache-sightings.json') };
    }

    function options(setup: Awaited<ReturnType<typeof rig>>, probes: Record<string, Probe>, overrides = {}) {
        return {
            cache: () => setup.php,
            sightingsFile: setup.sightingsFile,
            knownFolders: () => [],
            probe: async (path: string) => probes[path] ?? 'unknown',
            ...overrides
        };
    }

    it('removes a vanished checkout over three passes and a week, files before the manifest', async () => {
        const setup = await rig();
        await setup.manifest('a', '/work/gone');
        const sweep = (now: number) => sweepPhpCache(options(setup, { '/work/gone': 'missing' }), now, new AbortController().signal);

        await sweep(0);
        await sweep(4 * DAY);

        expect(await readdir(setup.cache)).toHaveLength(3);

        const reclaimed = await sweep(8 * DAY);

        expect(reclaimed.files).toBe(3);
        expect(await readdir(setup.cache)).toEqual([]);
        expect(JSON.parse(await readFile(setup.sightingsFile, 'utf8')).roots['/work/gone'].count).toBe(3);
    });

    it('finishes an owner a stopped pass left with its manifest only', async () => {
        const setup = await rig();
        await setup.write('owner-a.json', JSON.stringify({ format: 1, kind: 'project', path: '/p', folder: '/p', files: ['project-a.bin'], lastUsedMs: 0 }));

        await sweepPhpCache(options(setup, { '/p': 'present' }), NOW, new AbortController().signal);

        expect(await readdir(setup.cache)).toEqual([]);
    });

    it('honors an abort before it removes anything', async () => {
        const setup = await rig();
        await setup.write('project-a.bin.tmp');
        const abort = new AbortController();
        const reclaimed = await sweepPhpCache(options(setup, {}, { knownFolders: () => (abort.abort(), []) }), NOW, abort.signal);

        expect(reclaimed.files).toBe(0);
        expect(await readdir(setup.cache)).toEqual(['project-a.bin.tmp']);
    });

    it('evicts over the budget but never the cache of a live folder', async () => {
        const setup = await rig({ folders: ['/work/live'], any: true });
        await setup.manifest('a', '/work/live');
        await setup.manifest('b', '/work/other');

        await sweepPhpCache(options(setup, { '/work/live': 'present', '/work/other': 'present' }, { budget: 0 }), NOW, new AbortController().signal);

        expect((await readdir(setup.cache)).sort()).toEqual(['owner-a.json', 'project-a.bin', 'words-a.bin']);
    });

    it('does nothing without a PHP install', async () => {
        const reclaimed = await sweepPhpCache({ cache: () => null, sightingsFile: '/none', knownFolders: () => [] }, NOW, new AbortController().signal);

        expect(reclaimed).toEqual({ files: 0, bytes: 0 });
    });

    it('holds the gate while it removes, so a start waits for it', async () => {
        const setup = await rig();
        await setup.write('project-a.bin.tmp');
        let waited = false;
        const sweeping = sweepPhpCache(options(setup, {}), NOW, new AbortController().signal);
        await new Promise((resolve) => setImmediate(resolve));
        const start = setup.gate.wait().then(() => {
            waited = true;
        });

        await sweeping;
        await start;

        expect(waited).toBe(true);
        expect(await readdir(setup.cache)).toEqual([]);
    });
});
