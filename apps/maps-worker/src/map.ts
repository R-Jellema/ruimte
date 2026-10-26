import type { Deps } from './deps.ts';
import type { Env } from './env.ts';
import { upstreamPathAllowed } from './grant.ts';
import { failure } from './http.ts';
import { rewriteDocument } from './rewrite.ts';
import { UPSTREAM_HEADERS, bodyKind, cacheSeconds, upstreamUrl } from './upstream.ts';

/* The answer for a client, with how long it may keep it. TomTom's own headers are never copied across. */
function answer(body: BodyInit | null, contentType: string | null, seconds: number): Response {
    const headers = new Headers({ 'x-content-type-options': 'nosniff', 'cache-control': seconds > 0 ? `private, max-age=${seconds}` : 'no-store' });
    if (contentType) {
        headers.set('content-type', contentType);
    }
    return new Response(body, { headers });
}

/* Under a key without the ticket or TomTom's key in it, since two clients may share what one fetched. */
function cacheKey(path: string, query: readonly (readonly [string, string])[]): Request {
    const sorted = query.toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return new Request(`https://cache.maps.invalid/${path}?${new URLSearchParams(sorted as [string, string][]).toString()}`);
}

export interface Resource {
    /* The upstream path, which `upstreamPathAllowed` has already passed (or the fixed path of the style). */
    path: string;
    query: readonly (readonly [string, string])[];
}

/*
 * One GET of a map resource through TomTom. A response is kept at the edge for no longer than TomTom's own
 * Cache-Control allows. A JSON body is rewritten so that it names this service only, and checked for the key
 * after that; a body of a type this service does not know is not passed on at all.
 */
export async function fetchMapResource(deps: Deps, env: Env, resource: Resource, trusted = false): Promise<Response> {
    const key = env.TOMTOM_API_KEY;
    const secret = env.MAP_TICKET_SECRET;
    if (!key || !secret) {
        return failure('maps-unconfigured', 'The maps service is not configured yet');
    }
    if (!trusted && !upstreamPathAllowed(resource.path)) {
        return failure('not-found', 'No such map resource');
    }
    const cacheRequest = cacheKey(resource.path, resource.query);
    const cached = await deps.cache.match(cacheRequest);
    if (cached) {
        const remaining = Math.ceil((Number(cached.headers.get('x-kept-until') ?? 0) - deps.now()) / 1000);
        return answer(cached.body, cached.headers.get('content-type'), Math.max(0, remaining));
    }
    let upstream: Response;
    try {
        upstream = await deps.fetch(upstreamUrl(resource.path, resource.query, key), { method: 'GET', headers: UPSTREAM_HEADERS, redirect: 'manual' });
    } catch {
        return failure('upstream', 'The map provider did not answer');
    }
    const refuse = async (refusal: Response): Promise<Response> => {
        await upstream.body?.cancel();
        return refusal;
    };

    if (upstream.status === 404) {
        return refuse(failure('not-found', 'No such map resource'));
    }
    if (upstream.status === 429) {
        return refuse(failure('rate-limited', 'The map provider is limiting this service, try again later', { 'retry-after': '60' }));
    }
    if (!upstream.ok) {
        // Whatever TomTom said may echo the key, so the client gets only that it failed.
        return refuse(failure('upstream', `The map provider refused the request (${upstream.status})`));
    }
    const seconds = cacheSeconds(upstream.headers);
    const contentType = upstream.headers.get('content-type');
    const kind = bodyKind(contentType);
    if (kind === 'refused') {
        return refuse(failure('upstream', 'The map provider sent a kind of body this service does not pass on'));
    }
    let body: BodyInit | null = upstream.body;
    if (kind === 'json') {
        let text: string;
        try {
            text = JSON.stringify(await rewriteDocument(JSON.parse(await upstream.text()), secret, key, env.PUBLIC_ORIGIN));
        } catch {
            return failure('upstream', 'The map provider sent a body this service cannot read');
        }
        if (text.includes(key)) {
            return failure('upstream', 'The map provider sent a body this service will not pass on');
        }
        body = text;
    }
    if (seconds > 0 && body !== null) {
        const [forClient, forCache] = typeof body === 'string' ? [body, body] : (body as ReadableStream).tee();
        const kept = answer(forCache, contentType, seconds);
        kept.headers.set('cache-control', `public, max-age=${seconds}`);
        kept.headers.set('x-kept-until', String(deps.now() + seconds * 1000));
        deps.defer(deps.cache.put(cacheRequest, kept));
        return answer(forClient, contentType, seconds);
    }
    return answer(body, contentType, seconds);
}
