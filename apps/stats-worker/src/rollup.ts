import { readUsage, type SqlApi } from './analytics.ts';
import { openDays, type UsageRow } from './queries.ts';

// D1 binds at most 100 values to one statement, and a row takes five.
const ROWS_PER_INSERT = 19;

/* Replaces every row of the days from `from` to `to` in one batch, so running it twice leaves the same table. */
export function replaceStatements(db: D1Database, from: string, to: string, rows: readonly UsageRow[]): ReturnType<D1Database['prepare']>[] {
    const statements = [db.prepare('DELETE FROM usage_daily WHERE date >= ?1 AND date <= ?2').bind(from, to)];
    const inRange = rows.filter((row) => row.date >= from && row.date <= to);
    for (let start = 0; start < inRange.length; start += ROWS_PER_INSERT) {
        const chunk = inRange.slice(start, start + ROWS_PER_INSERT);
        const placeholders = chunk.map(() => '(?, ?, ?, ?, ?)').join(', ');
        statements.push(
            db
                .prepare(`INSERT INTO usage_daily (date, dimension, value, metric, total) VALUES ${placeholders}`)
                .bind(...chunk.flatMap((row) => [row.date, row.dimension, row.value, row.metric, row.total]))
        );
    }
    return statements;
}

/* The nightly rollup: the days that can still change, read again from Analytics Engine and stored whole. */
export async function rollUp(db: D1Database, api: SqlApi, now: number, request: typeof fetch = fetch): Promise<{ from: string; to: string; rows: number }> {
    const { from, to } = openDays(now);
    const rows = await readUsage(api, from, to, null, request);
    await db.batch(replaceStatements(db, from, to, rows));
    return { from, to, rows: rows.length };
}

export async function readRollups(db: D1Database, from: string, to: string): Promise<UsageRow[]> {
    const result = await db
        .prepare('SELECT date, dimension, value, metric, total FROM usage_daily WHERE date >= ?1 AND date <= ?2')
        .bind(from, to)
        .all<UsageRow>();
    return result.results;
}
