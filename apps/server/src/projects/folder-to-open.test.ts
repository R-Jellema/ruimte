import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { folderToOpen } from './folder-to-open.ts';

describe('a folder to open', () => {
    test('starting at ~ is in the home of this machine', () => {
        expect(folderToOpen('~/Development/Projects/testbed', '/Users/bas')).toBe(resolve('/Users/bas/Development/Projects/testbed'));
        expect(folderToOpen('~', '/Users/bas')).toBe(resolve('/Users/bas'));
        expect(folderToOpen(' ~/projects/ ', '/Users/bas')).toBe(resolve('/Users/bas/projects'));
    });

    test('a full path is taken as it is, tidied', () => {
        expect(folderToOpen('/srv/app/../site/', '/Users/bas')).toBe(resolve('/srv/site'));
    });

    test('a relative path is refused rather than resolved against the folder the daemon runs in', () => {
        for (const folder of ['projects/testbed', './testbed', '../testbed', '~bas/testbed']) {
            expect(() => folderToOpen(folder, '/Users/bas')).toThrow('is not a full path');
        }
    });
});
