import { describe, expect, test } from 'bun:test';
import type { GitIdentity } from '@ruimte/contracts';
import { rankCandidates } from './remote-candidates';

function identity(path: string, rootCommits: string[], branch?: string): GitIdentity {
    return { path, rootCommits, heads: [], ...(branch === undefined ? {} : { branch }) };
}

const PROJECTS = [
    { projectId: 'p1', name: 'notes', folder: '/work/notes' },
    { projectId: 'p2', name: 'ruimte', folder: '/work/ruimte' },
    { projectId: 'p3', name: 'plain', folder: '/work/plain' }
];

describe('the checkouts a machine could hold', () => {
    test('the project with a root commit of ours comes first, and a folder outside git is left out', () => {
        const ranked = rankCandidates({ rootCommits: ['aaa'] }, PROJECTS, [
            identity('/work/notes', ['zzz']),
            identity('/work/ruimte', ['aaa', 'bbb'], 'main'),
            { path: '/work/plain', error: 'not-a-repository' }
        ]);
        expect(ranked.map((candidate) => [candidate.projectId, candidate.same, candidate.branch])).toEqual([
            ['p2', true, 'main'],
            ['p1', false, null]
        ]);
    });

    test('keeps the order of the projects among those that match, and among those that do not', () => {
        const ranked = rankCandidates({ rootCommits: ['aaa'] }, PROJECTS, [
            identity('/work/notes', ['aaa']),
            identity('/work/ruimte', ['aaa']),
            identity('/work/plain', ['zzz'])
        ]);
        expect(ranked.map((candidate) => candidate.projectId)).toEqual(['p1', 'p2', 'p3']);
    });

    test('with no repository here nothing matches, and every repository over there is a possibility', () => {
        const ranked = rankCandidates(null, PROJECTS, [identity('/work/notes', ['aaa']), identity('/work/ruimte', ['bbb'])]);
        expect(ranked.map((candidate) => candidate.same)).toEqual([false, false]);
    });
});
