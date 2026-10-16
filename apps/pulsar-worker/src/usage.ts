import { UsageBatchSchema, usageDataPoints, usageDateOf, usageDateProblem, type UsageDataPoint } from '@ruimte/pulsar';
import { clientIp, failure, noContent, readBody } from './http.ts';

// Seven days with every counter at its cap stay under 12 KB.
const MAX_USAGE_BODY_BYTES = 32 * 1024;

/*
 * A machine sends one batch a day, and machines behind one address share it. The platform binding only
 * counts per minute, so a day's cap is kept in D1 beside it.
 */
export const USAGE_BATCHES_PER_IP_PER_DAY = 20;

const DAY_MS = 86_400_000;
export const USAGE_BUCKET_PREFIX = 'usage:';

export interface UsageDeps {
    db: D1Database;
    // Absent until the dataset is bound, and then the route answers `not-configured`.
    dataset?: { writeDataPoint(point: UsageDataPoint): void };
    burst?: { limit(options: { key: string }): Promise<{ success: boolean }> };
    now: () => number;
}

/* The day's bucket of an address: a digest, so the table never holds the address itself, and gone after the day. */
async function bucketOf(ip: string, now: number): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`pulsar-usage-ip-v1\n${usageDateOf(now)}\n${ip}`));
    return `${USAGE_BUCKET_PREFIX}${btoa(String.fromCharCode(...new Uint8Array(digest)))}`;
}

async function overDailyLimit(db: D1Database, ip: string, now: number): Promise<boolean> {
    const row = await db
        .prepare(
            'INSERT INTO rate_limit (bucket, window_start, count) VALUES (?1, ?2, 1) ON CONFLICT (bucket, window_start) DO UPDATE SET count = count + 1 RETURNING count'
        )
        .bind(await bucketOf(ip, now), now - (now % DAY_MS))
        .first<{ count: number }>();
    return row !== null && row.count > USAGE_BATCHES_PER_IP_PER_DAY;
}

function rateLimited(): Response {
    return failure('rate-limited', 'Too many usage batches from this address today', { 'retry-after': '3600' });
}

/*
 * `POST /v1/usage`: finished days of anonymous counts. Neither the address nor the body is logged, and
 * a batch is taken whole or refused whole, so a machine knows exactly which days it may forget.
 */
export async function acceptUsage(request: Request, deps: UsageDeps): Promise<Response> {
    if (!deps.dataset) {
        return failure('not-configured', 'Usage statistics are not collected here');
    }
    const ip = clientIp(request);
    if (deps.burst && !(await deps.burst.limit({ key: ip })).success) {
        return rateLimited();
    }
    const now = deps.now();
    if (await overDailyLimit(deps.db, ip, now)) {
        return rateLimited();
    }
    const body = await readBody(request, UsageBatchSchema, MAX_USAGE_BODY_BYTES);
    if ('response' in body) {
        return body.response;
    }
    for (const [index, day] of body.value.days.entries()) {
        const problem = usageDateProblem(day.date, now);
        if (problem !== null) {
            return failure('bad-request', `days.${index}.date: ${problem}`);
        }
    }
    for (const day of body.value.days) {
        for (const point of usageDataPoints(day)) {
            deps.dataset.writeDataPoint(point);
        }
    }
    return noContent();
}

/* What the daily cleanup drops: a usage bucket once its day is over, every other bucket an hour after its minute. */
export function rateLimitCleanup(db: D1Database, now: number): ReturnType<D1Database['prepare']>[] {
    return [
        db.prepare("DELETE FROM rate_limit WHERE bucket NOT LIKE 'usage:%' AND window_start < ?1").bind(now - 60 * 60_000),
        db.prepare("DELETE FROM rate_limit WHERE bucket LIKE 'usage:%' AND window_start < ?1").bind(now - (now % DAY_MS))
    ];
}
