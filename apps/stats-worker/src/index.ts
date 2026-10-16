import { AccessKeys, accessCertsFetcher, verifyAccessToken } from './access.ts';
import { readUsage, type SqlApi } from './analytics.ts';
import type { Env } from './env.ts';
import { buildDashboard, mergeRows } from './model.ts';
import { RANGES, renderPage } from './page.ts';
import { addDays, dateOf, type UsageRow } from './queries.ts';
import { readRollups, rollUp } from './rollup.ts';

const DEFAULT_RANGE = 90;
// The days Analytics Engine is read for on every view: the ones the rollup may still change, and today.
const LIVE_DAYS = 9;

const SECURITY_HEADERS = {
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff'
};

let accessKeys: { teamDomain: string; keys: AccessKeys } | null = null;

function keysFor(teamDomain: string): AccessKeys {
    if (accessKeys?.teamDomain !== teamDomain) {
        accessKeys = { teamDomain, keys: new AccessKeys(accessCertsFetcher(teamDomain), Date.now) };
    }
    return accessKeys.keys;
}

function plain(status: number, text: string): Response {
    return new Response(text, { status, headers: { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8' } });
}

function sqlApi(env: Env): SqlApi | null {
    return env.ANALYTICS_API_TOKEN ? { accountId: env.ACCOUNT_ID, token: env.ANALYTICS_API_TOKEN } : null;
}

async function dashboard(request: Request, env: Env): Promise<Response> {
    const requested = Number(new URL(request.url).searchParams.get('days'));
    const days = (RANGES as readonly number[]).includes(requested) ? requested : DEFAULT_RANGE;
    const now = Date.now();
    const today = dateOf(now);
    // Today is still being counted on every machine, so the page ends yesterday.
    const from = addDays(today, -days);
    const notices: string[] = [];

    const rollups = await readRollups(env.DB, from, today);
    let live: UsageRow[] = [];
    const api = sqlApi(env);
    if (api === null) {
        notices.push('ANALYTICS_API_TOKEN is not set, so this shows the nightly rollups only, and the rollup cannot run.');
    } else {
        try {
            live = await readUsage(api, addDays(today, -LIVE_DAYS), today, caches.default);
        } catch (error) {
            console.error('analytics', error instanceof Error ? error.message : 'failed');
            notices.push('Analytics Engine did not answer; the last nine days may be missing.');
        }
    }
    const page = renderPage(buildDashboard(mergeRows(rollups, live), from, addDays(today, -1), today), days, notices);
    return new Response(page, { headers: { ...SECURITY_HEADERS, 'content-type': 'text/html; charset=utf-8' } });
}

async function route(request: Request, env: Env): Promise<Response> {
    // Fails closed: without the Access settings, or with any token but the one person's, the data stays shut.
    if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
        return plain(503, 'Access is not configured for this dashboard.');
    }
    const token = request.headers.get('cf-access-jwt-assertion') ?? '';
    const config = { teamDomain: env.ACCESS_TEAM_DOMAIN, audience: env.ACCESS_AUD, email: env.ACCESS_EMAIL };
    if ((await verifyAccessToken(token, config, keysFor(env.ACCESS_TEAM_DOMAIN), Date.now())) === null) {
        return plain(403, 'Forbidden');
    }
    const path = new URL(request.url).pathname;
    if (path !== '/' || request.method !== 'GET') {
        return plain(404, 'Not found');
    }
    return dashboard(request, env);
}

export default {
    async fetch(request, env) {
        try {
            return await route(request, env);
        } catch (error) {
            console.error('unhandled', error instanceof Error ? error.message : 'failed');
            return plain(500, 'Something went wrong');
        }
    },
    async scheduled(_controller, env) {
        const api = sqlApi(env);
        if (api === null) {
            console.warn('usage rollup skipped: ANALYTICS_API_TOKEN is not set');
            return;
        }
        const result = await rollUp(env.DB, api, Date.now());
        console.log(`usage rollup ${result.from} to ${result.to}: ${result.rows} rows`);
    }
} satisfies ExportedHandler<Env>;
