import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { integrationFiles } from './test-integration.ts';

let root: string;
beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-test-discovery-'));
    for (const path of [
        'apps/client/current.integration.test.ts',
        'apps/client/current.browser.integration.test.ts',
        'apps/server/current.integration.test.ts',
        'packages/contracts/current.integration.test.ts',
        'scripts/current.integration.test.ts',
        'docs/reports/private/old.integration.test.ts',
        'docs/reports/private/old.browser.integration.test.ts',
        'apps/client/node_modules/library/foreign.integration.test.ts',
        'packages/contracts/node_modules/library/foreign.browser.integration.test.ts'
    ]) {
        const target = join(root, path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, 'throw new Error("Must not be loaded during discovery");');
    }
});
afterAll(async () => {
    await rm(root, { recursive: true, force: true });
});

test('default integration discovery selects active workspace tests, leaving archives, dependencies and browser tests out', () => {
    expect(integrationFiles(root)).toEqual([
        './apps/client/current.integration.test.ts',
        './apps/server/current.integration.test.ts',
        './packages/contracts/current.integration.test.ts',
        './scripts/current.integration.test.ts'
    ]);
});

test('browser discovery selects only active browser tests', () => {
    expect(integrationFiles(root, true)).toEqual(['./apps/client/current.browser.integration.test.ts']);
});
