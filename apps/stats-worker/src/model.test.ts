import { describe, expect, test } from 'bun:test';
import { buildDashboard, mergeRows, weekStart } from './model.ts';
import { renderPage } from './page.ts';
import type { UsageRow } from './queries.ts';

function row(date: string, metric: UsageRow['metric'], total: number, dimension: UsageRow['dimension'] = '', value = ''): UsageRow {
    return { date, dimension, value, metric, total };
}

const TODAY = '2026-10-16';

describe('the dashboard', () => {
    test('counts the active machines per day, per ISO week and per month from the first-of flags', () => {
        const rows = [
            row('2026-10-12', 'active', 3),
            row('2026-10-12', 'firstThisWeek', 3),
            row('2026-10-13', 'active', 4),
            row('2026-10-13', 'firstThisWeek', 1),
            row('2026-10-01', 'firstThisMonth', 5),
            row('2026-10-12', 'firstThisMonth', 1),
            row('2026-10-15', 'active', 2)
        ];
        const dashboard = buildDashboard(rows, '2026-09-28', TODAY, TODAY);
        expect(dashboard.daily.points.find((point) => point.label === '2026-10-13')?.value).toBe(4);
        expect(dashboard.weekly.points.find((point) => point.label === '2026-W42')?.value).toBe(4);
        expect(dashboard.monthly.points.find((point) => point.label === '2026-10')?.value).toBe(6);
        expect(dashboard.tiles[0]).toEqual({ label: 'Daily active', value: 2, note: '2026-10-15' });
    });

    test('leaves out a week or month the range starts inside of', () => {
        const dashboard = buildDashboard([], '2026-10-14', TODAY, TODAY);
        expect(dashboard.weekly.points).toEqual([]);
        expect(dashboard.monthly.points).toEqual([]);
        expect(buildDashboard([], '2026-10-12', TODAY, TODAY).weekly.points.map((point) => point.label)).toEqual(['2026-W42']);
    });

    test('folds versions past the eighth into Other and shares segments over recent days', () => {
        const rows = Array.from({ length: 10 }, (_, i) => row('2026-10-15', 'active', 10 - i, 'version', `0.${i}.0`));
        const versions = buildDashboard(rows, '2026-09-01', TODAY, TODAY).versions;
        expect(versions).toHaveLength(9);
        expect(versions[0]).toEqual({ label: '0.0.0', value: 10 });
        expect(versions.at(-1)).toEqual({ label: 'Other', value: 3 });
        const signed = buildDashboard(
            [row('2026-10-15', 'active', 3, 'signedIn', '1'), row('2026-10-15', 'active', 1, 'signedIn', '0')],
            '2026-09-01',
            TODAY,
            TODAY
        );
        expect(signed.tiles[3]?.value).toBe(0.75);
    });

    test('follows a cohort through the weeks after its first, and leaves the weeks to come open', () => {
        const rows = [
            row('2026-09-28', 'firstThisWeek', 4, 'cohortWeek', '2026-W40'),
            row('2026-10-06', 'firstThisWeek', 2, 'cohortWeek', '2026-W40'),
            row('2026-10-15', 'firstThisWeek', 1, 'cohortWeek', '2026-W40')
        ];
        const [cohort] = buildDashboard(rows, '2026-09-01', TODAY, TODAY).retention;
        expect(cohort?.size).toBe(4);
        expect(cohort?.shares.slice(0, 4)).toEqual([1, 0.5, 0.25, null]);
    });

    test('takes a day from Analytics Engine over its rollup', () => {
        const merged = mergeRows([row('2026-10-14', 'active', 1), row('2026-10-01', 'active', 7)], [row('2026-10-14', 'active', 3)]);
        expect(merged).toEqual([row('2026-10-01', 'active', 7), row('2026-10-14', 'active', 3)]);
    });

    test('finds the Monday of an ISO week', () => {
        expect(weekStart('2026-W42')).toBe('2026-10-12');
        expect(weekStart('2026-W01')).toBe('2025-12-29');
    });

    test('renders a page that escapes what it shows', () => {
        const rows = [row('2026-10-15', 'active', 1, 'version', '<script>'), row('2026-10-15', 'active', 1), row('2026-10-15', 'startupP50', 800)];
        const html = renderPage(buildDashboard(rows, '2026-09-01', TODAY, TODAY), 90, ['A notice']);
        expect(html).toContain('&lt;script&gt;');
        expect(html).not.toContain('<script>');
        expect(html).toContain('A notice');
        expect(html).toContain('800 ms');
    });
});
