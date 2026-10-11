import { describe, expect, test } from 'bun:test';
import { pullRequestCommands } from '@/shell/pull-request-commands';

describe('the palette rows that show a pull request', () => {
    test('a folder with one repository keeps the single row, on that repository', () => {
        const rows = pullRequestCommands('/work', [{ path: '/work/backend', label: 'backend' }], () => undefined);
        expect(rows.map((row) => row.id)).toEqual(['pr-show']);
    });

    test('a folder whose repositories are not read yet keeps the single row, on the folder', () => {
        expect(pullRequestCommands('/work', [], () => undefined).map((row) => row.id)).toEqual(['pr-show']);
    });

    test('several repositories get a row each, named after the repository', () => {
        const rows = pullRequestCommands(
            '/work',
            [
                { path: '/work/backend', label: 'backend' },
                { path: '/work/web', label: 'web' }
            ],
            () => undefined
        );
        expect(rows.map((row) => row.id)).toEqual(['pr-show-in-/work/backend', 'pr-show-in-/work/web']);
        expect(rows[0]!.label).toContain('backend');
    });
});
