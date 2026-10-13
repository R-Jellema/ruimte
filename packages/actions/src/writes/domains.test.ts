import { describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { ACTION_DEFINITIONS, type ActionName } from '../index.ts';

describe('the write tests', () => {
    test('have a file for every domain with an action that changes something', () => {
        const domains = new Set(
            (Object.keys(ACTION_DEFINITIONS) as ActionName[])
                .filter((name) => ACTION_DEFINITIONS[name].effect !== 'read')
                .map((name) => ACTION_DEFINITIONS[name].domain)
        );
        const files = readdirSync(import.meta.dir)
            .filter((file) => file.endsWith('.test.ts') && file !== 'domains.test.ts')
            .map((file) => file.slice(0, -'.test.ts'.length));
        expect(files.sort()).toEqual([...domains].sort());
    });
});
