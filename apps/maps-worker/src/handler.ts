import { mapsSecretBytes, verifyMapsTicket } from '@ruimte/pulsar';
import type { Deps } from './deps.ts';
import type { Env } from './env.ts';
import { geocode } from './geocode.ts';
import { allowedOrigin, corsHeaders, failure, json } from './http.ts';
import { fetchMapResource } from './map.ts';
import { allowedMapPath, cleanQuery } from './upstream.ts';

const STYLE_PATH = 'maps/orbis/assets/styles/0.*/style';

// Monochrome, so the markers of a block carry the colour.
const STYLE_OF = { light: 'basic_mono-light', dark: 'basic_mono-dark' } as const;

/* The ticket of a request: its `authorization` bearer, checked with the secret alone. */
async function subjectOf(request: Request, env: Env, deps: Deps): Promise<string | null> {
    const match = /^Bearer ([^\s]+)$/.exec(request.headers.get('authorization') ?? '');
    if (!match?.[1] || !env.MAP_TICKET_SECRET) {
        return null;
    }
    return (await verifyMapsTicket(env.MAP_TICKET_SECRET, match[1], deps.now()))?.subject ?? null;
}

async function api(request: Request, env: Env, deps: Deps): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') {
        return json({ ok: true });
    }
    if (!env.TOMTOM_API_KEY || !env.MAP_TICKET_SECRET || mapsSecretBytes(env.MAP_TICKET_SECRET) === null) {
        return failure('maps-unconfigured', 'The maps service is not configured yet');
    }
    const subject = await subjectOf(request, env, deps);
    if (subject === null) {
        return failure('bad-ticket', 'Ask the address book for a new map ticket');
    }
    if (env.TICKET_LIMIT && !(await env.TICKET_LIMIT.limit({ key: subject })).success) {
        return failure('rate-limited', 'Too many map requests, try again in a minute', { 'retry-after': '60' });
    }
    if (request.method === 'GET' && url.pathname === '/v1/style') {
        const theme = url.searchParams.get('theme');
        if (theme !== 'light' && theme !== 'dark') {
            return failure('bad-request', 'theme is light or dark');
        }
        return fetchMapResource(deps, env, {
            path: STYLE_PATH,
            query: [
                ['apiVersion', '1'],
                ['map', STYLE_OF[theme]]
            ]
        });
    }
    if (request.method === 'GET' && url.pathname.startsWith('/v1/map/')) {
        let path: string;
        try {
            path = decodeURIComponent(url.pathname.slice('/v1/map/'.length));
        } catch {
            return failure('not-found', 'No such map resource');
        }
        return allowedMapPath(path) ? fetchMapResource(deps, env, { path, query: cleanQuery(url.searchParams) }) : failure('not-found', 'No such map resource');
    }
    if (request.method === 'POST' && url.pathname === '/v1/geocode') {
        return geocode(request, deps, env);
    }
    return failure('not-found', 'No such route');
}

/* Every answer, a failure included, says which page may read it; a preflight needs no ticket. */
export async function handle(request: Request, env: Env, deps: Deps): Promise<Response> {
    const cors = corsHeaders(allowedOrigin(request, env));
    const response =
        request.method === 'OPTIONS'
            ? new Response(null, { status: 204 })
            : await api(request, env, deps).catch(() => failure('internal', 'Something went wrong in the maps service'));
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(cors)) {
        headers.set(name, value);
    }
    return new Response(response.body, { status: response.status, headers });
}
