import type { Deps } from './deps.ts';
import type { Env } from './env.ts';
import { failure } from './http.ts';
import { UPSTREAM_HEADERS, cacheSeconds, sanitizedText, upstreamUrl } from './upstream.ts';

const TEXT_TYPE = /^(application\/(json|[a-z.+-]*\+json)|text\/)/i;

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
    return new Request(`https://cache.maps.invalid/${path}?${new URLSearchParams(query as [string, string][]).toString()}`);
}

/*
 * One GET of a map resource through TomTom: a style, a TileJSON, a tile, a sprite or a glyph range. A
 * response is kept at the edge for no longer than TomTom's own Cache-Control allows, and a body that
 * names the key or TomTom's address is rewritten before it is kept or sent.
 */
export async function fetchMapResource(deps: Deps, env: Env, resource: { path: string; query: readonly (readonly [string, string])[] }): Promise<Response> {
    const key = env.TOMTOM_API_KEY;
    if (!key) {
        return failure('maps-unconfigured', 'The maps service has no TomTom key yet');
    }
    const cacheRequest = cacheKey(resource.path, resource.query);
    const cached = await deps.cache.match(cacheRequest);
    if (cached) {
        const remaining = Math.ceil((Number(cached.headers.get('x-kept-until') ?? 0) - deps.now()) / 1000);
        return answer(cached.body, cached.headers.get('content-type'), Math.max(0, remaining));
    }
    let upstream: Response;
    try {
        upstream = await deps.fetch(upstreamUrl(resource.path, resource.query, key), { method: 'GET', headers: UPSTREAM_HEADERS, redirect: 'error' });
    } catch {
        return failure('upstream', 'The map provider did not answer');
    }
    if (upstream.status === 404) {
        await upstream.body?.cancel();
        return failure('not-found', 'No such map resource');
    }
    if (upstream.status === 429) {
        await upstream.body?.cancel();
        return failure('rate-limited', 'The map provider is limiting this service, try again later', { 'retry-after': '60' });
    }
    if (!upstream.ok) {
        // Whatever TomTom said may echo the key, so the client gets only that it failed.
        await upstream.body?.cancel();
        return failure('upstream', `The map provider refused the request (${upstream.status})`);
    }
    const seconds = cacheSeconds(upstream.headers);
    const contentType = upstream.headers.get('content-type');
    let body: BodyInit | null = upstream.body;
    if (contentType !== null && TEXT_TYPE.test(contentType)) {
        const text = sanitizedText(await upstream.text(), key, env.PUBLIC_ORIGIN, /json/i.test(contentType));
        if (text === null) {
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
