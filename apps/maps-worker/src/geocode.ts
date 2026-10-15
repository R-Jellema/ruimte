import { MapsGeocodeRequestSchema, type MapsGeocodeResult } from '@ruimte/pulsar';
import { z } from 'zod';
import type { Deps } from './deps.ts';
import type { Env } from './env.ts';
import { failure, json } from './http.ts';
import { TOMTOM_ORIGIN, UPSTREAM_HEADERS } from './upstream.ts';

const MAX_BODY_BYTES = 2048;

/* The body, or null when it is larger than the limit: counted in bytes as they arrive, so a large one is never held. */
async function boundedText(request: Request): Promise<string | null> {
    const declared = Number(request.headers.get('content-length') ?? 0);
    if (declared > MAX_BODY_BYTES || request.body === null) {
        return declared > MAX_BODY_BYTES ? null : '';
    }
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        size += value.byteLength;
        if (size > MAX_BODY_BYTES) {
            await reader.cancel();
            return null;
        }
        chunks.push(value);
    }
    const joined = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) {
        joined.set(chunk, at);
        at += chunk.byteLength;
    }
    return new TextDecoder().decode(joined);
}

const SearchSchema = z.object({
    results: z
        .array(
            z.object({
                position: z.object({ lat: z.number(), lon: z.number() }),
                address: z.object({ freeformAddress: z.string().optional() }).optional(),
                poi: z.object({ name: z.string().optional() }).optional()
            })
        )
        .default([])
});

/*
 * `POST /v1/geocode`: the first place TomTom's search finds for a text. The key goes in the header only, and nothing of the person but the text reaches TomTom.
 */
export async function geocode(request: Request, deps: Deps, env: Env): Promise<Response> {
    const key = env.TOMTOM_API_KEY;
    if (!key) {
        return failure('maps-unconfigured', 'The maps service has no TomTom key yet');
    }
    const text = await boundedText(request);
    let raw: unknown;
    try {
        raw = text === null ? null : JSON.parse(text);
    } catch {
        raw = null;
    }
    const body = MapsGeocodeRequestSchema.safeParse(raw);
    if (!body.success) {
        return failure('bad-request', 'Send { query, language? } with a query of 1 to 200 characters');
    }
    const params = new URLSearchParams({ apiVersion: '1', limit: '1' });
    if (body.data.language !== undefined) {
        params.set('language', body.data.language);
    }
    let upstream: Response;
    try {
        upstream = await deps.fetch(`${TOMTOM_ORIGIN}/maps/orbis/places/search/${encodeURIComponent(body.data.query)}.json?${params.toString()}`, {
            method: 'GET',
            headers: { ...UPSTREAM_HEADERS, 'tomtom-api-key': key },
            redirect: 'manual'
        });
    } catch {
        return failure('upstream', 'The map provider did not answer');
    }
    if (upstream.status === 429) {
        await upstream.body?.cancel();
        return failure('rate-limited', 'The map provider is limiting this service, try again later', { 'retry-after': '60' });
    }
    if (!upstream.ok) {
        // A key without the Search right answers 403 here; the body is not passed on.
        await upstream.body?.cancel();
        return failure('upstream', `The map provider refused the search (${upstream.status})`);
    }
    const parsed = SearchSchema.safeParse(await upstream.json().catch(() => null));
    if (!parsed.success) {
        return failure('upstream', 'The map provider sent a search answer this service cannot read');
    }
    const first = parsed.data.results[0];
    const results: MapsGeocodeResult['results'] = [];
    if (first && Math.abs(first.position.lat) <= 90 && Math.abs(first.position.lon) <= 180) {
        const label = [first.poi?.name, first.address?.freeformAddress].filter((part): part is string => part !== undefined && part !== '').join(', ');
        results.push({ lat: first.position.lat, lon: first.position.lon, label: label || body.data.query });
    }
    return json({ results } satisfies MapsGeocodeResult);
}
