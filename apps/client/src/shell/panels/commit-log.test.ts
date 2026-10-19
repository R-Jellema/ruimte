import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { githubPicture, groupCommits, shownRefs, type LogRow } from './commit-log';

function commitAt(local: string): LogRow {
    return { hash: local, shortHash: local, subject: local, author: 'a', at: new Date(local).getTime() / 1000, refs: [], cwd: '/repo', repo: '' };
}

function seconds(local: string): number {
    return new Date(local).getTime() / 1000;
}

describe('groupCommits', () => {
    // The clock moves in Amsterdam on 29 March and 25 October 2026, so the day before has 23 or 25 hours.
    const zone = process.env.TZ;
    beforeAll(() => {
        process.env.TZ = 'Europe/Amsterdam';
    });
    afterAll(() => {
        if (zone === undefined) {
            delete process.env.TZ;
        } else {
            process.env.TZ = zone;
        }
    });

    test('a commit from last night is under Yesterday', () => {
        const sections = groupCommits([commitAt('2026-10-13T09:00:00'), commitAt('2026-10-12T23:30:00')], seconds('2026-10-13T10:00:00'));
        expect(sections.map((section) => section.label)).toEqual(['Today', 'Yesterday']);
    });

    test('the day after the clocks went forward still has a Yesterday', () => {
        const sections = groupCommits([commitAt('2026-03-29T12:00:00')], seconds('2026-03-30T10:00:00'));
        expect(sections.map((section) => section.label)).toEqual(['Yesterday']);
    });

    test('the day after the clocks went back still has a Yesterday', () => {
        const sections = groupCommits([commitAt('2026-10-25T12:00:00')], seconds('2026-10-26T10:00:00'));
        expect(sections.map((section) => section.label)).toEqual(['Yesterday']);
    });
});

describe('shownRefs', () => {
    test('a branch and its remote twin on one commit are one name', () => {
        expect(shownRefs({ refs: ['main', 'origin/main', 'origin/HEAD'], remoteRefs: ['origin/main', 'origin/HEAD'] })).toEqual([
            { name: 'main', tracked: 'origin/main' }
        ]);
    });

    test('a remote branch apart from its local one keeps its own name', () => {
        expect(shownRefs({ refs: ['origin/main'], remoteRefs: ['origin/main'] })).toEqual([{ name: 'origin/main', tracked: null }]);
    });

    test('a local branch with a slash is not taken for a remote', () => {
        expect(shownRefs({ refs: ['fix/a', 'a'], remoteRefs: [] })).toEqual([
            { name: 'fix/a', tracked: null },
            { name: 'a', tracked: null }
        ]);
    });

    test('a daemon without remoteRefs shows every name', () => {
        expect(shownRefs({ refs: ['main', 'origin/main'] }).map((ref) => ref.name)).toEqual(['main', 'origin/main']);
    });
});

describe('githubPicture', () => {
    test('a private address with an id points at that account', () => {
        expect(githubPicture('123+bas@users.noreply.github.com')).toBe('https://avatars.githubusercontent.com/u/123?s=32');
    });

    test('an older private address points at the login', () => {
        expect(githubPicture('bas@users.noreply.github.com')).toBe('https://github.com/bas.png?size=32');
    });

    test('any other address has no picture', () => {
        expect(githubPicture('bas@example.com')).toBeNull();
        expect(githubPicture(undefined)).toBeNull();
    });
});
