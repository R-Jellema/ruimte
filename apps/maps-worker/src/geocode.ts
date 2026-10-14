import { MapsGeocodeRequestSchema, type MapsGeocodeResult } from '@ruimte/pulsar';
import { z } from 'zod';
import type { Deps } from './deps.ts';
import type { Env } from './env.ts';
import { failure, json } from './http.ts';
import { TOMTOM_ORIGIN, UPSTREAM_HEADERS } from './upstream.ts';

const MAX_BODY_BYTES = 2048;

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
 * `POST /v1/geocode`: the first place TomTom's search finds for a text. The key goes both ways TomTom
 * takes it (header and query), and nothing of the person but the text reaches TomTom.
 */
export async function geocode(request: Request, deps: Deps, env: Env): Promise<Response> {
    const key = env.TOMTOM_API_KEY;
    if (!key) {
        return failure('maps-unconfigured', 'The maps service has no TomTom key yet');
    }
    const text = await request.text();
    let raw: unknown;
    try {
        raw = text.length > MAX_BODY_BYTES ? null : JSON.parse(text);
    } catch {
        raw = null;
    }
    const body = MapsGeocodeRequestSchema.safeParse(raw);
    if (!body.success) {
        return failure('bad-request', 'Send { query, language? } with a query of 1 to 200 characters');
    }
    const params = new URLSearchParams({ apiVersion: '1', limit: '1', key });
    if (body.data.language !== undefined) {
        params.set('language', body.data.language);
    }
    let upstream: Response;
    try {
        upstream = await deps.fetch(`${TOMTOM_ORIGIN}/maps/orbis/places/search/${encodeURIComponent(body.data.query)}.json?${params.toString()}`, {
            method: 'GET',
            headers: { ...UPSTREAM_HEADERS, 'tomtom-api-key': key },
            redirect: 'error'
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
