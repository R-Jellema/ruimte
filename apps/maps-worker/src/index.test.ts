import { describe, expect, test } from 'bun:test';
import { MapsErrorSchema, MapsGeocodeResultSchema } from '@ruimte/pulsar';
import { KEY, ORIGIN, harness } from './test/harness.ts';

const TOMTOM_STYLE = {
    version: 8,
    sprite: `https://api.tomtom.com/maps/orbis/assets/sprites/1/sprite?apiVersion=1&key=${KEY}`,
    glyphs: `https://api.tomtom.com/maps/orbis/assets/fonts/1/{fontstack}/{range}.pbf?key=${KEY}&apiVersion=1`,
    sources: {
        vector: { type: 'vector', tiles: [`https://api.tomtom.com/maps/orbis/display/vector/tile/{z}/{x}/{y}?apiVersion=2&key=${KEY}`], maxzoom: 14 },
        tilejson: { type: 'vector', url: `https://api.tomtom.com/maps/orbis/display/vector/tile.json?key=${KEY}` }
    },
    layers: [{ id: 'background', type: 'background' }]
};

function json(body: unknown, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', ...headers } });
}

async function errorCode(response: { json(): Promise<unknown> }): Promise<string> {
    return MapsErrorSchema.parse(await response.json()).error.code;
}

describe('before anything is asked of TomTom', () => {
    test('health answers without a ticket and says nothing about the configuration', async () => {
        const maps = harness({ TOMTOM_API_KEY: undefined });
        const response = await maps.request('/health', { ticket: null });
        expect(await response.json()).toEqual({ ok: true });
        expect(maps.upstream).toEqual([]);
    });

    test('without the TomTom key, the secret or a long enough secret it says it is not configured', async () => {
        for (const env of [{ TOMTOM_API_KEY: undefined }, { MAP_TICKET_SECRET: undefined }, { MAP_TICKET_SECRET: 'short' }, { TOMTOM_API_KEY: '' }]) {
            const maps = harness(env);
            const response = await maps.request('/v1/style?theme=light');
            expect(response.status).toBe(503);
            expect(await errorCode(response)).toBe('maps-unconfigured');
            expect(maps.upstream).toEqual([]);
        }
    });

    test('a request with no ticket, a forged one, one for another secret or an ended one is refused and fetches nothing', async () => {
        const maps = harness();
        const forged = `${(await maps.ticket()).split('.').slice(0, 2).join('.')}.${'A'.repeat(43)}`;
        const ended = await maps.ticket('account-1', -1_000);
        for (const ticket of [null, 'nonsense', forged, ended]) {
            const response = await maps.request('/v1/style?theme=light', { ticket });
            expect(response.status).toBe(401);
            expect(await errorCode(response)).toBe('bad-ticket');
        }
        expect(maps.upstream).toEqual([]);
        expect(maps.limited).toEqual([]);
    });

    test('a ticket in the query is no ticket: it travels in the header only', async () => {
        const maps = harness();
        const ticket = await maps.ticket();
        expect((await maps.request(`/v1/style?theme=light&t=${ticket}`, { ticket: null })).status).toBe(401);
    });

    test('the rate limit counts the subject of the ticket, never the account, and refuses with a retry', async () => {
        const maps = harness();
        await maps.request('/v1/style?theme=light');
        expect(maps.limited).toHaveLength(1);
        expect(maps.limited[0]).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(maps.limited[0]).not.toContain('account-1');
        maps.refuse = true;
        const response = await maps.request('/v1/style?theme=light');
        expect(response.status).toBe(429);
        expect(response.headers.get('retry-after')).toBe('60');
        expect(await errorCode(response)).toBe('rate-limited');
        expect(maps.upstream).toHaveLength(1);
    });
});

describe('the style', () => {
    test('is fetched with the key, and leaves with this service for every address and no key anywhere', async () => {
        const maps = harness();
        maps.answers = [() => json(TOMTOM_STYLE)];
        const response = await maps.request('/v1/style?theme=dark');
        expect(response.status).toBe(200);
        expect(maps.upstream[0]!.url).toBe(`https://api.tomtom.com/maps/orbis/assets/styles/0.*/style?apiVersion=1&map=basic_mono-dark&key=${KEY}`);
        const text = await response.text();
        expect(text).not.toContain(KEY);
        expect(text).not.toContain('key=');
        expect(text).not.toContain('api.tomtom.com');
        const style = JSON.parse(text);
        expect(style.sprite).toBe(`${ORIGIN}/v1/map/maps/orbis/assets/sprites/1/sprite?apiVersion=1`);
        expect(style.glyphs).toBe(`${ORIGIN}/v1/map/maps/orbis/assets/fonts/1/{fontstack}/{range}.pbf?apiVersion=1`);
        expect(style.sources.vector.tiles).toEqual([`${ORIGIN}/v1/map/maps/orbis/display/vector/tile/{z}/{x}/{y}?apiVersion=2`]);
        expect(style.sources.tilejson.url).toBe(`${ORIGIN}/v1/map/maps/orbis/display/vector/tile.json`);
        expect(style.layers).toEqual(TOMTOM_STYLE.layers);
    });

    test('light and dark are the two monochrome maps, and anything else is a bad request', async () => {
        const maps = harness();
        maps.answers = [() => json(TOMTOM_STYLE)];
        await maps.request('/v1/style?theme=light');
        expect(maps.upstream[0]!.url).toContain('map=basic_mono-light');
        for (const path of ['/v1/style', '/v1/style?theme=sepia', '/v1/style?theme=basic_street-light']) {
            const response = await maps.request(path);
            expect(response.status).toBe(400);
        }
        expect(maps.upstream).toHaveLength(1);
    });

    test('a body that still holds the key after the rewrite is not passed on', async () => {
        const maps = harness();
        maps.answers = [() => json({ version: 8, name: `made with ${KEY}` })];
        const response = await maps.request('/v1/style?theme=light');
        expect(response.status).toBe(502);
        expect(await response.text()).not.toContain(KEY);
    });
});

describe('a map resource', () => {
    test('a tile is fetched with the key and nothing of the client, and arrives as the bytes TomTom sent', async () => {
        const maps = harness();
        const bytes = new Uint8Array([0x1a, 0x02, 0x08, 0x01]);
        maps.answers = [
            () => new Response(bytes, { headers: { 'content-type': 'application/x-protobuf', 'set-cookie': 'a=b', 'access-control-allow-origin': '*' } })
        ];
        const response = await maps.request('/v1/map/maps/orbis/display/vector/tile/12/2105/1348?apiVersion=2&key=attacker', {
            headers: {
                cookie: 'session=1',
                referer: 'https://page.test/',
                'user-agent': 'Mozilla',
                'x-forwarded-for': '203.0.113.9',
                'cf-connecting-ip': '203.0.113.9',
                origin: 'app://ruimte'
            }
        });
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
        expect(response.headers.get('content-type')).toBe('application/x-protobuf');
        expect(response.headers.get('set-cookie')).toBeNull();
        expect(response.headers.get('access-control-allow-origin')).toBe('app://ruimte');
        const [call] = maps.upstream;
        expect(call!.url).toBe(`https://api.tomtom.com/maps/orbis/display/vector/tile/12/2105/1348?apiVersion=2&key=${KEY}`);
        expect([...call!.headers.keys()].toSorted()).toEqual(['accept', 'user-agent']);
        expect(call!.headers.get('user-agent')).toBe('ruimte-maps');
    });

    test('only map display and its assets are reachable, never another TomTom service or a path out of them', async () => {
        const maps = harness();
        for (const path of [
            '/v1/map/maps/orbis/routing/calculateRoute/1,2:3,4',
            '/v1/map/maps/orbis/places/search/pizza.json',
            '/v1/map/search/2/search/pizza.json',
            '/v1/map/maps/orbis/display/../routing/x',
            '/v1/map/maps/orbis/display/%2e%2e/routing/x',
            '/v1/map/maps/orbis/display//x',
            '/v1/map/maps/orbis/display/',
            '/v1/map/',
            '/v1/tile/1/2/3',
            '/v1/unknown'
        ]) {
            const response = await maps.request(path);
            expect(response.status, path).toBe(404);
        }
        expect((await maps.request('/v1/map/maps/orbis/display/vector/tile/1/1/1', { method: 'POST', body: '{}' })).status).toBe(404);
        expect(maps.upstream).toEqual([]);
    });

    test('a JSON body is rewritten like the style, and a sprite image is passed untouched', async () => {
        const maps = harness();
        maps.answers = [() => json({ tiles: [`https://api.tomtom.com/maps/orbis/display/vector/tile/{z}/{x}/{y}?key=${KEY}`] })];
        const tilejson = await (await maps.request('/v1/map/maps/orbis/display/vector/tile.json')).json();
        expect(tilejson).toEqual({ tiles: [`${ORIGIN}/v1/map/maps/orbis/display/vector/tile/{z}/{x}/{y}`] });
        const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
        maps.answers = [() => new Response(png, { headers: { 'content-type': 'image/png' } })];
        const sprite = await maps.request('/v1/map/maps/orbis/assets/sprites/1/sprite.png');
        expect(new Uint8Array(await sprite.arrayBuffer())).toEqual(png);
    });

    test('what TomTom refuses with is never repeated to the client', async () => {
        const cases: [number, number, string][] = [
            [404, 404, 'not-found'],
            [429, 429, 'rate-limited'],
            [403, 502, 'upstream'],
            [500, 502, 'upstream']
        ];
        for (const [from, status, code] of cases) {
            const maps = harness();
            maps.answers = [() => new Response(`denied for key ${KEY}`, { status: from })];
            const response = await maps.request('/v1/map/maps/orbis/display/vector/tile/1/1/1');
            expect(response.status).toBe(status);
            expect(await errorCode(response.clone())).toBe(code);
            expect(await response.text()).not.toContain(KEY);
        }
        const maps = harness();
        maps.answers = [
            () => {
                throw new Error(`network down for ${KEY}`);
            }
        ];
        const response = await maps.request('/v1/map/maps/orbis/display/vector/tile/1/1/1');
        expect(response.status).toBe(502);
        expect(await response.text()).not.toContain(KEY);
    });
});

describe('the edge cache', () => {
    const tile = '/v1/map/maps/orbis/display/vector/tile/12/2105/1348?apiVersion=2';

    test('keeps a response for no longer than TomTom says, under a key with neither ticket nor key in it', async () => {
        const maps = harness();
        maps.answers = [() => new Response('tile', { headers: { 'content-type': 'application/x-protobuf', 'cache-control': 'public, max-age=3600' } })];
        const first = await maps.request(tile);
        expect(first.headers.get('cache-control')).toBe('private, max-age=3600');
        expect(await first.text()).toBe('tile');
        expect([...maps.cached.keys()]).toEqual(['https://cache.maps.invalid/maps/orbis/display/vector/tile/12/2105/1348?apiVersion=2']);
        const stored = [...maps.cached.values()][0]!;
        expect(stored.headers.get('cache-control')).toBe('public, max-age=3600');
        for (const url of maps.cached.keys()) {
            expect(url).not.toContain(KEY);
            expect(url).not.toContain('Bearer');
        }
        // Another account asks for it later, from the cache.
        maps.now += 1_800_000;
        const second = await maps.request(tile, { ticket: await maps.ticket('account-2') });
        expect(await second.text()).toBe('tile');
        expect(second.headers.get('cache-control')).toBe('private, max-age=1800');
        expect(maps.upstream).toHaveLength(1);
        // Past TomTom's own limit it asks again.
        maps.now += 1_801_000;
        await maps.request(tile);
        expect(maps.upstream).toHaveLength(2);
    });

    test('two spellings of one query are one entry, and a client key never reaches it', async () => {
        const maps = harness();
        maps.answers = [() => new Response('tile', { headers: { 'content-type': 'application/x-protobuf', 'cache-control': 'max-age=60' } })];
        await maps.request('/v1/map/maps/orbis/display/vector/tile/1/1/1?b=2&a=1&key=attacker');
        await maps.request('/v1/map/maps/orbis/display/vector/tile/1/1/1?a=1&b=2');
        expect(maps.upstream).toHaveLength(1);
        expect(maps.upstream[0]!.url).toBe(`https://api.tomtom.com/maps/orbis/display/vector/tile/1/1/1?a=1&b=2&key=${KEY}`);
    });

    test('keeps nothing TomTom did not allow keeping: no header, no-store, private or an age past its life', async () => {
        for (const headers of [{}, { 'cache-control': 'no-store' }, { 'cache-control': 'private, max-age=60' }, { 'cache-control': 'max-age=60', age: '60' }]) {
            const maps = harness();
            maps.answers = [() => new Response('tile', { headers: { 'content-type': 'application/x-protobuf', ...headers } })];
            const response = await maps.request(tile);
            expect(response.headers.get('cache-control')).toBe('no-store');
            expect(maps.cached.size).toBe(0);
        }
    });

    test('counts the age TomTom reports and prefers s-maxage', async () => {
        const maps = harness();
        maps.answers = [
            () => new Response('tile', { headers: { 'content-type': 'application/x-protobuf', 'cache-control': 'max-age=60, s-maxage=600', age: '100' } })
        ];
        const response = await maps.request(tile);
        expect(response.headers.get('cache-control')).toBe('private, max-age=500');
    });

    test('keeps a rewritten style, not the one TomTom sent', async () => {
        const maps = harness();
        maps.answers = [() => json(TOMTOM_STYLE, { 'cache-control': 'max-age=600' })];
        await maps.request('/v1/style?theme=light');
        const stored = await [...maps.cached.values()][0]!.text();
        expect(stored).not.toContain(KEY);
        expect(stored).not.toContain('api.tomtom.com');
    });
});

describe('geocoding', () => {
    function ask(maps: ReturnType<typeof harness>, body: unknown): Promise<Response> {
        return maps.request('/v1/geocode', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });
    }

    test('answers the first place TomTom finds, with its name and address', async () => {
        const maps = harness();
        maps.answers = [
            () =>
                json({
                    summary: { numResults: 1 },
                    results: [{ position: { lat: 52.0907, lon: 5.1214 }, address: { freeformAddress: 'Domplein, 3512 JC Utrecht' }, poi: { name: 'Domtoren' } }]
                })
        ];
        const response = await ask(maps, { query: 'Domtoren Utrecht/Netherlands?', language: 'nl' });
        expect(MapsGeocodeResultSchema.parse(await response.json())).toEqual({
            results: [{ lat: 52.0907, lon: 5.1214, label: 'Domtoren, Domplein, 3512 JC Utrecht' }]
        });
        const [call] = maps.upstream;
        expect(call!.url).toBe(
            `https://api.tomtom.com/maps/orbis/places/search/Domtoren%20Utrecht%2FNetherlands%3F.json?apiVersion=1&limit=1&key=${KEY}&language=nl`
        );
        expect(call!.headers.get('tomtom-api-key')).toBe(KEY);
        expect([...call!.headers.keys()].toSorted()).toEqual(['accept', 'tomtom-api-key', 'user-agent']);
    });

    test('a search that finds nothing is an empty list', async () => {
        const maps = harness();
        maps.answers = [() => json({ summary: { numResults: 0 }, results: [] })];
        expect(await (await ask(maps, { query: 'zzzzzz' })).json()).toEqual({ results: [] });
    });

    test('a key without the Search right, a limit and a failure are told apart and never echo TomTom', async () => {
        for (const [from, status, code] of [
            [403, 502, 'upstream'],
            [429, 429, 'rate-limited'],
            [500, 502, 'upstream']
        ] as const) {
            const maps = harness();
            maps.answers = [() => new Response(`no for ${KEY}`, { status: from })];
            const response = await ask(maps, { query: 'Utrecht' });
            expect(response.status).toBe(status);
            expect(await errorCode(response.clone())).toBe(code);
            expect(await response.text()).not.toContain(KEY);
        }
    });

    test('a request that is no query is a bad request and asks TomTom nothing', async () => {
        const maps = harness();
        for (const body of [
            'not json',
            {},
            { query: '' },
            { query: '   ' },
            { query: 'x'.repeat(201) },
            { query: 'a', language: 'not a language' },
            'x'.repeat(3000)
        ]) {
            expect((await ask(maps, body)).status).toBe(400);
        }
        expect((await maps.request('/v1/geocode')).status).toBe(404);
        expect(maps.upstream).toEqual([]);
    });
});

describe('who may read the answers', () => {
    test('the desktop app, loopback and the listed web client may, and a preflight needs no ticket', async () => {
        const maps = harness();
        for (const origin of ['app://ruimte', 'http://localhost:5173', 'http://127.0.0.1:4210', 'https://station.test']) {
            const response = await maps.request('/v1/style?theme=light', { method: 'OPTIONS', headers: { origin }, ticket: null });
            expect(response.status).toBe(204);
            expect(response.headers.get('access-control-allow-origin')).toBe(origin);
            expect(response.headers.get('access-control-allow-headers')).toContain('authorization');
        }
        const other = await maps.request('/v1/style?theme=light', { method: 'OPTIONS', headers: { origin: 'https://evil.test' }, ticket: null });
        expect(other.headers.get('access-control-allow-origin')).toBeNull();
        expect(maps.upstream).toEqual([]);
    });

    test('a refusal carries the headers too, so the page can read why', async () => {
        const maps = harness();
        const response = await maps.request('/v1/style?theme=light', { headers: { origin: 'app://ruimte' }, ticket: null });
        expect(response.status).toBe(401);
        expect(response.headers.get('access-control-allow-origin')).toBe('app://ruimte');
    });
});
