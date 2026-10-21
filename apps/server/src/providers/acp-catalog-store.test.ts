import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acpCatalogPath, acpCatalogStore } from './acp-catalog-store.ts';

const homes: string[] = [];

async function home(): Promise<string> {
    const folder = await mkdtemp(join(tmpdir(), 'ruimte-acp-catalog-'));
    homes.push(folder);
    return folder;
}

afterEach(async () => {
    await Promise.all(homes.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

describe('acpCatalogStore', () => {
    test('reads nothing before anything was saved', async () => {
        expect(acpCatalogStore(await home(), 'grok').load()).toBeNull();
    });

    test('keeps a value per kind in the machine folder, readable only by its owner', async () => {
        const folder = await home();
        acpCatalogStore(folder, 'grok').save({ commands: ['compact'] });
        expect(acpCatalogStore(folder, 'grok').load()).toEqual({ commands: ['compact'] });
        expect(acpCatalogStore(folder, 'copilot').load()).toBeNull();
        const path = acpCatalogPath(folder, 'grok');
        expect(path).toBe(join(folder, 'models', 'agents', 'grok.json'));
        expect((await stat(path)).mode & 0o777).toBe(0o600);
        expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ commands: ['compact'] });
    });

    test('a file that does not read as JSON counts as none', async () => {
        const folder = await home();
        acpCatalogStore(folder, 'grok').save({});
        await writeFile(acpCatalogPath(folder, 'grok'), '{ not json');
        expect(acpCatalogStore(folder, 'grok').load()).toBeNull();
    });
});
