import { rowsOf, usageQueries, type UsageQuery, type UsageRow } from './queries.ts';

export interface SqlApi {
    accountId: string;
    // An API token with Account Analytics Read and nothing else.
    token: string;
}

// Each answer is kept this long, so a dashboard open all day reads Analytics Engine a few times an hour at most.
const CACHE_SECONDS = 600;
// Never a real address: only the key of an entry in this worker's own cache.
const CACHE_ORIGIN = 'https://stats-cache.internal';

export interface QueryCache {
    match(key: string): Promise<Response | undefined>;
    put(key: string, response: Response): Promise<void>;
}

async function digestOf(text: string): Promise<string> {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
    return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function runSql(api: SqlApi, sql: string, request: typeof fetch = fetch): Promise<Record<string, unknown>[]> {
    const response = await request(`https://api.cloudflare.com/client/v4/accounts/${api.accountId}/analytics_engine/sql`, {
        method: 'POST',
        headers: { authorization: `Bearer ${api.token}` },
        body: sql
    });
    if (!response.ok) {
        throw new Error(`Analytics Engine answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
    const body = (await response.json()) as { data?: Record<string, unknown>[] };
    return Array.isArray(body.data) ? body.data : [];
}

async function cachedRows(api: SqlApi, query: UsageQuery, cache: QueryCache | null, request: typeof fetch): Promise<UsageRow[]> {
    const key = `${CACHE_ORIGIN}/${await digestOf(query.sql)}`;
    const hit = await cache?.match(key);
    if (hit) {
        return (await hit.json()) as UsageRow[];
    }
    const rows = rowsOf(query, await runSql(api, query.sql, request));
    await cache?.put(key, new Response(JSON.stringify(rows), { headers: { 'content-type': 'application/json', 'cache-control': `max-age=${CACHE_SECONDS}` } }));
    return rows;
}

/* Every row of the days from `from` to `to`, straight from Analytics Engine. */
export async function readUsage(api: SqlApi, from: string, to: string, cache: QueryCache | null = null, request: typeof fetch = fetch): Promise<UsageRow[]> {
    const parts = await Promise.all(usageQueries(from, to).map((query) => cachedRows(api, query, cache, request)));
    return parts.flat();
}
