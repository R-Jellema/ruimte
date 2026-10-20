import { describe, expect, it } from 'bun:test';
import { join, resolve } from 'node:path';
import { findManifests, topmostManifests, type ReadDirectory } from './manifests.ts';

const WORK = resolve('/work');

/* A file system of folders by path, each with its entries; a folder missing from it cannot be read. */
function tree(folders: Record<string, string[]>): ReadDirectory {
    return async (folder) => {
        const entries = folders[folder];
        if (entries === undefined) {
            throw new Error(`ENOENT: ${folder}`);
        }
        return entries.map((entry) => (entry.endsWith('/') ? { name: entry.slice(0, -1), directory: true } : { name: entry, directory: false }));
    };
}

describe('Cargo manifests of a project', () => {
    const read = tree({
        [WORK]: ['Cargo.toml', 'apps/', 'node_modules/', '.git/', 'target/'],
        [join(WORK, 'apps')]: ['bridge/', 'speech/', 'site/'],
        [join(WORK, 'apps', 'bridge')]: ['Cargo.toml', 'src/'],
        [join(WORK, 'apps', 'bridge', 'src')]: ['main.rs'],
        [join(WORK, 'apps', 'speech')]: ['Cargo.toml'],
        [join(WORK, 'apps', 'site')]: ['package.json', 'deep/'],
        [join(WORK, 'apps', 'site', 'deep')]: ['inner/'],
        [join(WORK, 'apps', 'site', 'deep', 'inner')]: ['Cargo.toml'],
        [join(WORK, 'node_modules')]: ['Cargo.toml'],
        [join(WORK, '.git')]: ['Cargo.toml'],
        [join(WORK, 'target')]: ['Cargo.toml']
    });

    it('finds the manifests down to the depth, past hidden, dependency and build folders', async () => {
        expect(await findManifests(WORK, 'Cargo.toml', 3, read)).toEqual([
            join(WORK, 'Cargo.toml'),
            join(WORK, 'apps', 'bridge', 'Cargo.toml'),
            join(WORK, 'apps', 'speech', 'Cargo.toml')
        ]);
        expect(await findManifests(WORK, 'Cargo.toml', 4, read)).toContain(join(WORK, 'apps', 'site', 'deep', 'inner', 'Cargo.toml'));
        expect(await findManifests(WORK, 'Cargo.toml', 0, read)).toEqual([join(WORK, 'Cargo.toml')]);
        expect(await findManifests(resolve('/gone'), 'Cargo.toml', 3, read)).toEqual([]);
    });

    it('keeps only the manifests no other one holds, so a workspace names its members itself', () => {
        expect(topmostManifests([join(WORK, 'Cargo.toml'), join(WORK, 'apps', 'bridge', 'Cargo.toml')])).toEqual([join(WORK, 'Cargo.toml')]);
        expect(topmostManifests([join(WORK, 'apps', 'bridge', 'Cargo.toml'), join(WORK, 'apps', 'bridge-two', 'Cargo.toml')])).toEqual([
            join(WORK, 'apps', 'bridge', 'Cargo.toml'),
            join(WORK, 'apps', 'bridge-two', 'Cargo.toml')
        ]);
    });
});
