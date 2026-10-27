import { describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { ACTION_DEFINITIONS, ACTION_NAMES, type ActionName } from '../index.ts';
import { WRITE_CASES } from './cases.ts';

describe('the write tests', () => {
    test('keep confirmation fixture flags compatible with catalog descriptions in each domain', () => {
        // This guards catalog/fixture compatibility; runtime consent belongs to adapters and their callers.
        const promised = Object.fromEntries(
            Object.keys(WRITE_CASES).map((domain) => [
                domain,
                ACTION_NAMES.filter((name) => ACTION_DEFINITIONS[name].domain === domain && ACTION_DEFINITIONS[name].effect !== 'read')
                    .filter((name) => /confirmation/.test(ACTION_DEFINITIONS[name].description))
                    .sort()
            ])
        );
        const asked = Object.fromEntries(
            Object.entries(WRITE_CASES).map(([domain, cases]) => [
                domain,
                (Object.keys(cases) as ActionName[]).filter((name) => cases[name]?.confirms === true).sort()
            ])
        );
        expect(asked).toEqual(promised);
    });

    test('have a file for every domain with an action that changes something', () => {
        const domains = new Set(ACTION_NAMES.filter((name) => ACTION_DEFINITIONS[name].effect !== 'read').map((name) => ACTION_DEFINITIONS[name].domain));
        const files = readdirSync(import.meta.dir)
            .filter((file) => file.endsWith('.test.ts') && file !== 'domains.test.ts')
            .map((file) => file.slice(0, -'.test.ts'.length));
        expect(files.sort()).toEqual([...domains].sort());
    });

    test('have registered fixtures for exactly all actions that change something', () => {
        const writes = ACTION_NAMES.filter((name) => ACTION_DEFINITIONS[name].effect !== 'read');
        const domains = [...new Set(writes.map((name) => ACTION_DEFINITIONS[name].domain))];
        expect(Object.keys(WRITE_CASES).sort()).toEqual(domains.sort());
        expect(
            Object.values(WRITE_CASES)
                .flatMap((cases) => Object.keys(cases))
                .sort()
        ).toEqual(writes.sort());
    });
});
