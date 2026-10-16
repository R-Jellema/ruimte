import { describe, expect, test } from 'bun:test';
import { d1, migratedDatabase } from '../../pulsar-worker/src/test/sqlite-d1.ts';
import type { UsageRow } from './queries.ts';
import { readRollups, rollUp } from './rollup.ts';

const NOW = Date.parse('2026-10-16T02:40:00Z');
const API = { accountId: 'account', token: 'token' };

// Analytics Engine as far as the rollup sees it: every query answers with what the test put there.
function analytics(answer: (sql: string) => Record<string, unknown>[]): { request: typeof fetch; queries: string[] } {
    const queries: string[] = [];
    const request = (async (_url: string, init?: RequestInit) => {
        const sql = String(init?.body);
        queries.push(sql);
        return Response.json({ data: answer(sql) });
    }) as typeof fetch;
    return { request, queries };
}

function answer(sql: string, perDay: number): Record<string, unknown>[] {
    if (sql.includes("blob1 = 'day'") && sql.includes('AS active') && !sql.includes('AS value')) {
        return [
            { date: '2026-10-15', active: perDay, firstThisWeek: 1, projectsOpened: 2 },
            { date: '2026-10-07', active: 1 }
        ];
    }
    if (sql.includes('blob6 AS value')) {
        return [{ date: '2026-10-15', value: 'service', active: perDay }];
    }
    return [];
}

describe('the nightly rollup', () => {
    test('stores the open days from Analytics Engine, and a second run replaces them', async () => {
        const sqlite = migratedDatabase();
        const db = d1(sqlite);
        sqlite.query("INSERT INTO usage_daily (date, dimension, value, metric, total) VALUES ('2026-10-06', '', '', 'active', 9)").run();
        sqlite.query("INSERT INTO usage_daily (date, dimension, value, metric, total) VALUES ('2026-10-15', '', '', 'turnsClaude', 9)").run();

        const first = analytics((sql) => answer(sql, 3));
        expect(await rollUp(db, API, NOW, first.request)).toEqual({ from: '2026-10-07', to: '2026-10-15', rows: 5 });
        expect(first.queries).toHaveLength(10);

        const second = analytics((sql) => answer(sql, 4));
        await rollUp(db, API, NOW, second.request);
        const rows = await readRollups(db, '2026-10-01', '2026-10-31');
        const key = (row: UsageRow) => `${row.date} ${row.dimension}:${row.value} ${row.metric}=${row.total}`;
        expect(rows.map(key).sort()).toEqual([
            '2026-10-06 : active=9',
            '2026-10-07 : active=1',
            '2026-10-15 : active=4',
            '2026-10-15 : firstThisWeek=1',
            '2026-10-15 : projectsOpened=2',
            '2026-10-15 launcher:service active=4'
        ]);
    });

    test('stores many rows in statements D1 accepts', async () => {
        const sqlite = migratedDatabase();
        const many = analytics((sql) =>
            sql.includes('blob3 AS value') ? Array.from({ length: 120 }, (_, i) => ({ date: '2026-10-15', value: `0.${i}.0`, active: 1 })) : []
        );
        expect((await rollUp(d1(sqlite), API, NOW, many.request)).rows).toBe(120);
        expect(sqlite.query('SELECT COUNT(*) AS count FROM usage_daily').get()).toEqual({ count: 120 });
    });

    test('changes nothing when Analytics Engine fails', async () => {
        const sqlite = migratedDatabase();
        sqlite.query("INSERT INTO usage_daily (date, dimension, value, metric, total) VALUES ('2026-10-15', '', '', 'active', 9)").run();
        const failing = (async () => new Response('no', { status: 500 })) as unknown as typeof fetch;
        await expect(rollUp(d1(sqlite), API, NOW, failing)).rejects.toThrow();
        expect(sqlite.query('SELECT total FROM usage_daily').get()).toEqual({ total: 9 });
    });
});
