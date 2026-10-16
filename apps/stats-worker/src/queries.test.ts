import { describe, expect, test } from 'bun:test';
import { USAGE_POINTS } from '@ruimte/pulsar';
import { addDays, openDays, rowsOf, summedFields, usageQueries, type UsageQuery } from './queries.ts';

const queries = usageQueries('2026-10-07', '2026-10-15');

function queryOf(predicate: (query: UsageQuery) => boolean): UsageQuery {
    const found = queries.find(predicate);
    if (!found) {
        throw new Error('No such query');
    }
    return found;
}

describe('the rollup queries', () => {
    test('are one per point, one per segment and one for the startup times', () => {
        expect(queries.map((query) => (query.kind === 'totals' ? query.point : query.kind === 'segment' ? query.segment : query.kind))).toEqual([
            'day',
            'work',
            'verbs',
            'version',
            'platform',
            'arch',
            'launcher',
            'signedIn',
            'cohortWeek',
            'startup'
        ]);
    });

    test('weigh every sum by the sample interval, read the columns the layout names and leave the test versions out', () => {
        for (const query of queries) {
            expect(query.sql).toContain("blob2 >= '2026-10-07' AND blob2 <= '2026-10-15'");
            expect(query.sql).toContain("blob3 NOT LIKE '0.0.0%'");
            expect(query.sql).toEndWith('FORMAT JSON');
            expect(query.sql).not.toMatch(/SUM\((?!_sample_interval \* )/);
        }
        const work = queryOf((query) => query.kind === 'totals' && query.point === 'work').sql;
        expect(work).toContain("blob1 = 'work'");
        expect(work).toContain('SUM(_sample_interval * double1) AS viewsCanvas');
        expect(work).toContain('SUM(_sample_interval * double19) AS turnsApple');
        const day = queryOf((query) => query.kind === 'totals' && query.point === 'day').sql;
        expect(day).toContain('SUM(_sample_interval * double2) AS firstThisWeek');
        expect(day).not.toContain('startupMs');
    });

    test('break presence down by a segment and weigh the startup quantiles', () => {
        const version = queryOf((query) => query.kind === 'segment' && query.segment === 'version').sql;
        expect(version).toContain('blob3 AS value');
        expect(version).toContain('GROUP BY date, value');
        const startup = queryOf((query) => query.kind === 'startup').sql;
        expect(startup).toContain('quantileExactWeighted(0.5)(double4, _sample_interval) AS startupP50');
        expect(startup).toContain('double4 > 0');
    });

    test('refuse a date that is not one, so nothing else reaches the SQL', () => {
        expect(() => usageQueries("2026-10-07' OR 1=1 --", '2026-10-15')).toThrow();
    });

    test('sum every count and presence, never the startup time', () => {
        expect(summedFields('day')).not.toContain('startupMs');
        expect(summedFields('day')).toContain('active');
        expect(summedFields('verbs')).toEqual([...USAGE_POINTS.verbs]);
    });
});

describe('the rows of an answer', () => {
    test('are one per metric above zero, numbers whatever their spelling', () => {
        const totals = queryOf((query) => query.kind === 'totals' && query.point === 'verbs');
        expect(rowsOf(totals, [{ date: '2026-10-15', verbsRead: '12', verbsAgent: 0, verbsCanvas: 3.5 }])).toEqual([
            { date: '2026-10-15', dimension: '', value: '', metric: 'verbsRead', total: 12 },
            { date: '2026-10-15', dimension: '', value: '', metric: 'verbsCanvas', total: 3.5 }
        ]);
    });

    test('carry the segment and its value', () => {
        const launcher = queryOf((query) => query.kind === 'segment' && query.segment === 'launcher');
        expect(rowsOf(launcher, [{ date: '2026-10-14', value: 'service', active: 4, firstThisWeek: 1, firstThisMonth: 0 }])).toEqual([
            { date: '2026-10-14', dimension: 'launcher', value: 'service', metric: 'active', total: 4 },
            { date: '2026-10-14', dimension: 'launcher', value: 'service', metric: 'firstThisWeek', total: 1 }
        ]);
    });

    test('skip a record without a date', () => {
        expect(
            rowsOf(
                queryOf((query) => query.kind === 'startup'),
                [{ date: null, startupP50: 3 }]
            )
        ).toEqual([]);
    });
});

describe('the open days', () => {
    test('run from the ninth day back to yesterday', () => {
        expect(openDays(Date.parse('2026-10-16T02:40:00Z'))).toEqual({ from: '2026-10-07', to: '2026-10-15' });
        expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    });
});
