import { describe, expect, test } from 'bun:test';
import { strandedBy } from './remote-relink';

describe('linking a machine again', () => {
    test('keeps the nodes in the checkout the old link named, worktrees of it included', () => {
        expect(strandedBy('/work/atlas', '/work/atlas', ['/work/atlas', '/home/b/.ruimte/worktrees/atlas-fix'])).toBeNull();
    });

    test('names the old checkout when another folder is chosen', () => {
        expect(strandedBy('/work/atlas-clone', '/work/atlas', ['/work/atlas'])).toBe('/work/atlas');
    });

    test('without the old checkout, needs every node inside the chosen folder', () => {
        expect(strandedBy('/work/atlas', null, ['/work/atlas/app', 'src'])).toBeNull();
        expect(strandedBy('/work/atlas', null, ['/work/atlas', '/work/atlas-old'])).toBe('/work/atlas-old');
    });
});
