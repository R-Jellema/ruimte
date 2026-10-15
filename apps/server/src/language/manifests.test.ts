import { describe, expect, it } from 'bun:test';
import { findManifests, topmostManifests, type ReadDirectory } from './manifests.ts';

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
        '/work': ['Cargo.toml', 'apps/', 'node_modules/', '.git/', 'target/'],
        '/work/apps': ['bridge/', 'speech/', 'site/'],
        '/work/apps/bridge': ['Cargo.toml', 'src/'],
        '/work/apps/bridge/src': ['main.rs'],
        '/work/apps/speech': ['Cargo.toml'],
        '/work/apps/site': ['package.json', 'deep/'],
        '/work/apps/site/deep': ['inner/'],
        '/work/apps/site/deep/inner': ['Cargo.toml'],
        '/work/node_modules': ['Cargo.toml'],
        '/work/.git': ['Cargo.toml'],
        '/work/target': ['Cargo.toml']
    });

    it('finds the manifests down to the depth, past hidden, dependency and build folders', async () => {
        expect(await findManifests('/work', 'Cargo.toml', 3, read)).toEqual([
            '/work/Cargo.toml',
            '/work/apps/bridge/Cargo.toml',
            '/work/apps/speech/Cargo.toml'
        ]);
        expect(await findManifests('/work', 'Cargo.toml', 4, read)).toContain('/work/apps/site/deep/inner/Cargo.toml');
        expect(await findManifests('/work', 'Cargo.toml', 0, read)).toEqual(['/work/Cargo.toml']);
        expect(await findManifests('/gone', 'Cargo.toml', 3, read)).toEqual([]);
    });

    it('keeps only the manifests no other one holds, so a workspace names its members itself', () => {
        expect(topmostManifests(['/work/Cargo.toml', '/work/apps/bridge/Cargo.toml'])).toEqual(['/work/Cargo.toml']);
        expect(topmostManifests(['/work/apps/bridge/Cargo.toml', '/work/apps/bridge-two/Cargo.toml'])).toEqual([
            '/work/apps/bridge/Cargo.toml',
            '/work/apps/bridge-two/Cargo.toml'
        ]);
    });
});
