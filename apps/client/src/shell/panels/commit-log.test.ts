import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { groupCommits, type LogRow } from './commit-log';

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
