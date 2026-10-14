import { beforeEach, describe, expect, test } from 'bun:test';
import { MAPS_URL, type MapsTicket } from '@ruimte/pulsar';
import { MapTickets, mapSourceFor } from '@/chat/map-source';

const HOUR = 3_600_000;

let now: number;
let asked: number;
let answer: () => Promise<MapsTicket>;

function ticket(expiresAt: number, mark = 'a'): MapsTicket {
    return { ticket: `${'S'.repeat(43)}.${expiresAt}.${mark.repeat(43)}`, expiresAt };
}

function tickets(): MapTickets {
    return new MapTickets({
        fetchTicket: () => {
            asked++;
            return answer();
        },
        now: () => now
    });
}

beforeEach(() => {
    now = 1_800_000_000_000;
    asked = 0;
    answer = async () => ticket(now + HOUR);
});

describe('the tickets a page holds', () => {
    test('one ask serves every tile, however many ask for the header at once', async () => {
        const held = tickets();
        expect(held.header()).toBeNull();
        await Promise.all([held.ensure(), held.ensure(), held.ensure()]);
        expect(asked).toBe(1);
        const headers = Array.from({ length: 50 }, () => held.header());
        expect(new Set(headers).size).toBe(1);
        expect(headers[0]).toStartWith('Bearer ');
        expect(asked).toBe(1);
    });

    test('is renewed in the background before it ends, and the old one serves until then', async () => {
        const held = tickets();
        await held.ensure();
        const first = held.header();
        now += HOUR - 5 * 60_000 - 1;
        expect(held.header()).toBe(first);
        expect(asked).toBe(1);
        answer = async () => ticket(now + HOUR, 'b');
        now += 2;
        // The request that sees the margin goes out with the ticket it has, and the renewal follows.
        expect(held.header()).toBe(first);
        await held.ensure();
        expect(asked).toBe(2);
        expect(held.header()).not.toBe(first);
    });

    test('a ticket past its end is no ticket', async () => {
        const held = tickets();
        await held.ensure();
        answer = () => new Promise(() => {});
        now += HOUR + 1;
        expect(held.header()).toBeNull();
    });

    test('a failed ask is not repeated for a minute, however many tiles want a header', async () => {
        answer = async () => {
            throw new Error('offline');
        };
        const held = tickets();
        await held.ensure();
        expect(held.state()).toEqual({ state: 'failed', since: now });
        for (let i = 0; i < 20; i++) {
            await held.ensure();
        }
        expect(asked).toBe(1);
        now += 60_000;
        answer = async () => ticket(now + HOUR);
        await held.ensure();
        expect(asked).toBe(2);
        expect(held.state().state).toBe('ready');
    });

    test('tells a listener when the state changes, and forgets the ticket on request', async () => {
        const held = tickets();
        const states: string[] = [];
        const stop = held.subscribe(() => states.push(held.state().state));
        await held.ensure();
        held.clear();
        stop();
        held.clear();
        expect(states).toEqual(['ready', 'none']);
        expect(held.header()).toBeNull();
    });
});

describe('the source of a map', () => {
    async function ready(): Promise<MapTickets> {
        const held = tickets();
        await held.ensure();
        return held;
    }

    test('is off for the reason it is off: the setting first, then no account, then no ticket yet', async () => {
        const held = await ready();
        expect(mapSourceFor({ enabled: false, signedIn: false, tickets: held })).toEqual({ state: 'off', reason: 'disabled' });
        expect(mapSourceFor({ enabled: true, signedIn: false, tickets: held })).toEqual({ state: 'off', reason: 'signed-out' });
        expect(mapSourceFor({ enabled: true, signedIn: true, tickets: tickets() })).toEqual({ state: 'off', reason: 'unavailable' });
    });

    test('draws the tiles of the map service, in the style of the theme, with the names of the language', async () => {
        const source = mapSourceFor({ enabled: true, signedIn: true, tickets: await ready() });
        if (source.state !== 'tiles') {
            throw new Error('Expected tiles');
        }
        expect(source.styleUrl('light')).toBe(`${MAPS_URL}/v1/style?theme=light`);
        expect(source.styleUrl('dark')).toBe(`${MAPS_URL}/v1/style?theme=dark`);
        expect(source.labelField?.('nl')).toBe('name_nl');
        expect(source.attribution).toBe('© TomTom');
    });

    test('adds the ticket as a header to a request for the map service and to no other address', async () => {
        const held = await ready();
        const source = mapSourceFor({ enabled: true, signedIn: true, tickets: held });
        if (source.state !== 'tiles') {
            throw new Error('Expected tiles');
        }
        const header = held.header()!;
        expect(source.transformRequest!(`${MAPS_URL}/v1/map/maps/orbis/display/vector/tile/1/1/1`)).toEqual({
            url: `${MAPS_URL}/v1/map/maps/orbis/display/vector/tile/1/1/1`,
            headers: { authorization: header }
        });
        for (const other of [
            'https://maps.ruimte.app.evil.test/v1/style',
            'https://evil.test/https://maps.ruimte.app/v1/style',
            'http://maps.ruimte.app/v1/style',
            'https://api.tomtom.com/maps/orbis/display/vector/tile/1/1/1',
            'data:image/png;base64,AAAA',
            'not a url',
            ''
        ]) {
            expect(source.transformRequest!(other)).toEqual({ url: other });
        }
    });

    test('draws no ticket into a request once the ticket is gone', async () => {
        const held = await ready();
        const source = mapSourceFor({ enabled: true, signedIn: true, tickets: held });
        if (source.state !== 'tiles') {
            throw new Error('Expected tiles');
        }
        held.clear();
        expect(source.transformRequest!(`${MAPS_URL}/v1/style?theme=light`)).toEqual({ url: `${MAPS_URL}/v1/style?theme=light` });
    });
});
