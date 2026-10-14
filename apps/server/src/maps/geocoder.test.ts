import { beforeEach, describe, expect, test } from 'bun:test';
import { mapsTicketMessage } from '@ruimte/pulsar';
import { Geocoder, type GeocoderOptions } from './geocoder.ts';

interface Call {
    url: string;
    init: RequestInit;
}

const TICKET = `${'S'.repeat(43)}.1800003600000.${'M'.repeat(43)}`;
const T0 = 1_800_000_000_000;

let calls: Call[];
let now: number;
let onAccount: boolean;
let ticketAnswer: () => Response;
let lookupAnswer: () => Response;

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function geocoder(extra: Partial<GeocoderOptions> = {}): Geocoder {
    return new Geocoder({
        fetch: async (url, init) => {
            calls.push({ url, init });
            return url.endsWith('/v1/maps/ticket') ? ticketAnswer() : lookupAnswer();
        },
        sign: (message) => `signed:${message}`,
        machineId: 'studio',
        onAccount: async () => onAccount,
        now: () => now,
        ...extra
    });
}

const urls = (): string[] => calls.map((call) => call.url);

beforeEach(() => {
    calls = [];
    now = T0;
    onAccount = true;
    ticketAnswer = () => json({ ticket: TICKET, expiresAt: T0 + 3_600_000 });
    lookupAnswer = () => json({ results: [{ lat: 52.0907, lon: 5.1214, label: 'Domtoren, Utrecht' }] });
});

describe('a lookup', () => {
    test('asks the address book for a ticket signed as the machine, then the map service with it', async () => {
        const reading = await geocoder().geocode('Domplein 1, Utrecht', 'en');
        expect(reading).toEqual({ state: 'found', lat: 52.0907, lon: 5.1214, label: 'Domtoren, Utrecht' });
        expect(urls()).toEqual(['https://pulsar.ruimte.app/v1/maps/ticket', 'https://maps.ruimte.app/v1/geocode']);
        const ticket = JSON.parse(calls[0]!.init.body as string);
        expect(ticket).toEqual({ machineId: 'studio', issuedAt: T0, signature: `signed:${mapsTicketMessage('studio', T0)}` });
        expect(new Headers(calls[0]!.init.headers).has('authorization')).toBe(false);
        expect(new Headers(calls[1]!.init.headers).get('authorization')).toBe(`Bearer ${TICKET}`);
        expect(JSON.parse(calls[1]!.init.body as string)).toEqual({ query: 'Domplein 1, Utrecht', language: 'en' });
    });

    test('keeps the ticket until five minutes before it ends, and asks one ticket for lookups made together', async () => {
        const subject = geocoder();
        await Promise.all([subject.geocode('a', 'en'), subject.geocode('b', 'en'), subject.geocode('c', 'en')]);
        expect(urls().filter((url) => url.endsWith('/ticket'))).toHaveLength(1);
        now = T0 + 3_600_000 - 5 * 60_000 - 1;
        await subject.geocode('d', 'en');
        expect(urls().filter((url) => url.endsWith('/ticket'))).toHaveLength(1);
        now += 2;
        await subject.geocode('e', 'en');
        expect(urls().filter((url) => url.endsWith('/ticket'))).toHaveLength(2);
    });

    test('a place the service does not know is not found, without blocking the next', async () => {
        lookupAnswer = () => json({ results: [] });
        const subject = geocoder();
        expect(await subject.geocode('zzz', 'en')).toMatchObject({ state: 'missing', code: 'not-found' });
        lookupAnswer = () => json({ results: [{ lat: 1, lon: 2, label: 'x' }] });
        expect(await subject.geocode('Utrecht', 'en')).toMatchObject({ state: 'found' });
    });

    test('a machine on no account asks nobody anything', async () => {
        onAccount = false;
        const reading = await geocoder().geocode('Utrecht', 'en');
        expect(reading).toMatchObject({ state: 'missing', code: 'no-account' });
        expect(calls).toEqual([]);
        // Signing in changes the answer at once.
        onAccount = true;
        expect(await geocoder().geocode('Utrecht', 'en')).toMatchObject({ state: 'found' });
    });
});

describe('what goes wrong', () => {
    test('an address book that lists no such machine reads as no account, and is not asked again at once', async () => {
        ticketAnswer = () => json({ error: { code: 'not-found' } }, 404);
        const subject = geocoder();
        expect(await subject.geocode('a', 'en')).toMatchObject({ code: 'no-account' });
        expect(await subject.geocode('b', 'en')).toMatchObject({ code: 'no-account' });
        expect(urls()).toEqual(['https://pulsar.ruimte.app/v1/maps/ticket']);
        now += 60_001;
        await subject.geocode('c', 'en');
        expect(urls()).toHaveLength(2);
    });

    test('an address book or a maps service without its secrets reads as unconfigured and holds off for minutes', async () => {
        ticketAnswer = () => json({ error: { code: 'not-configured' } }, 503);
        const subject = geocoder();
        expect(await subject.geocode('a', 'en')).toMatchObject({ code: 'maps-unconfigured' });
        await subject.geocode('b', 'en');
        expect(urls()).toHaveLength(1);

        ticketAnswer = () => json({ ticket: TICKET, expiresAt: T0 + 3_600_000 });
        lookupAnswer = () => json({ error: { code: 'maps-unconfigured' } }, 503);
        const other = geocoder();
        expect(await other.geocode('a', 'en')).toMatchObject({ code: 'maps-unconfigured' });
        await other.geocode('b', 'en');
        expect(urls().filter((url) => url.endsWith('/geocode'))).toHaveLength(1);
    });

    test('a key without the Search right is frozen as unavailable and not tried again in a loop', async () => {
        lookupAnswer = () => json({ error: { code: 'upstream' } }, 502);
        const subject = geocoder();
        const first = await subject.geocode('a', 'en');
        expect(first).toMatchObject({ state: 'missing', code: 'unavailable' });
        for (const address of ['b', 'c', 'd', 'e']) {
            expect(await subject.geocode(address, 'en')).toMatchObject({ code: 'unavailable' });
        }
        expect(urls().filter((url) => url.endsWith('/geocode'))).toHaveLength(1);
        now += 5 * 60_000 + 1;
        await subject.geocode('f', 'en');
        expect(urls().filter((url) => url.endsWith('/geocode'))).toHaveLength(2);
    });

    test('a limit holds the next lookups off for a minute', async () => {
        lookupAnswer = () => json({ error: { code: 'rate-limited' } }, 429);
        const subject = geocoder();
        expect(await subject.geocode('a', 'en')).toMatchObject({ code: 'rate-limited' });
        expect(await subject.geocode('b', 'en')).toMatchObject({ code: 'rate-limited' });
        expect(urls().filter((url) => url.endsWith('/geocode'))).toHaveLength(1);
    });

    test('a network that fails or answers nonsense is unreachable for a moment', async () => {
        const failing = geocoder({
            fetch: async (url, init) => {
                calls.push({ url, init });
                throw new TypeError('Unable to connect');
            }
        });
        expect(await failing.geocode('a', 'en')).toMatchObject({ code: 'unreachable' });
        await failing.geocode('b', 'en');
        expect(calls).toHaveLength(1);

        calls = [];
        ticketAnswer = () => new Response('<html>', { status: 200 });
        expect(await geocoder().geocode('a', 'en')).toMatchObject({ code: 'unreachable' });
        ticketAnswer = () => json({ ticket: TICKET, expiresAt: T0 + 3_600_000 });
        lookupAnswer = () => json({ results: [{ lat: 500, lon: 2, label: 'x' }] });
        expect(await geocoder().geocode('a', 'en')).toMatchObject({ code: 'unavailable' });
    });

    test('a ticket the map service refuses is replaced once, and a second refusal is given up on', async () => {
        let first = true;
        lookupAnswer = () => {
            if (first) {
                first = false;
                return json({ error: { code: 'bad-ticket' } }, 401);
            }
            return json({ results: [{ lat: 1, lon: 2, label: 'x' }] });
        };
        const subject = geocoder();
        expect(await subject.geocode('a', 'en')).toMatchObject({ state: 'found' });
        expect(urls().filter((url) => url.endsWith('/ticket'))).toHaveLength(2);

        calls = [];
        lookupAnswer = () => json({ error: { code: 'bad-ticket' } }, 401);
        const stubborn = geocoder();
        expect(await stubborn.geocode('a', 'en')).toMatchObject({ code: 'unavailable' });
        expect(urls()).toHaveLength(4);
        await stubborn.geocode('b', 'en');
        expect(urls()).toHaveLength(4);
    });

    test('passes the abort signal of the caller to the lookup', async () => {
        const controller = new AbortController();
        await geocoder().geocode('a', 'en', controller.signal);
        expect(calls[1]!.init.signal).toBe(controller.signal);
    });
});
