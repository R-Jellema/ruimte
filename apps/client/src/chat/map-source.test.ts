import { beforeEach, describe, expect, test } from 'bun:test';
import { MAPS_URL, type MapsTicket } from '@ruimte/pulsar';
import { MapTickets, mapSourceFor } from '@/chat/map-source';

const HOUR = 3_600_000;

let now: number;
let asked: number;
let answer: () => Promise<MapsTicket>;
let timers: Array<{ at: number; run: () => void; id: number }>;
let nextTimer: number;

function ticket(expiresAt: number, mark = 'a'): MapsTicket {
    return { ticket: `${'S'.repeat(43)}.${expiresAt}.${mark.repeat(43)}`, expiresAt };
}

function tickets(): MapTickets {
    return new MapTickets({
        fetchTicket: () => {
            asked++;
            return answer();
        },
        now: () => now,
        timers: {
            after: (run, ms) => {
                const id = nextTimer++;
                timers.push({ at: now + ms, run, id });
                return id;
            },
            cancel: (handle) => {
                timers = timers.filter((timer) => timer.id !== handle);
            }
        }
    });
}

/* Moves the clock on and runs the timers that fall due on the way, then lets the asks they started finish. */
async function advance(ms: number): Promise<void> {
    const end = now + ms;
    for (;;) {
        const due = timers.filter((timer) => timer.at <= end).toSorted((a, b) => a.at - b.at)[0];
        if (due === undefined) {
            break;
        }
        timers = timers.filter((timer) => timer.id !== due.id);
        now = Math.max(now, due.at);
        due.run();
        await settle();
    }
    now = end;
}

async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) {
        await Promise.resolve();
    }
}

beforeEach(() => {
    now = 1_800_000_000_000;
    asked = 0;
    timers = [];
    nextTimer = 1;
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

    test('a header asked for with no ticket starts the ask, so the next request has one', async () => {
        const held = tickets();
        expect(held.header()).toBeNull();
        await settle();
        expect(asked).toBe(1);
        expect(held.header()).toStartWith('Bearer ');
    });

    test('is renewed by a timer before it ends while a map listens, and the old one serves until then', async () => {
        const held = tickets();
        held.subscribe(() => {});
        await advance(0);
        expect(asked).toBe(1);
        const first = held.header();
        await advance(HOUR - 5 * 60_000 - 1);
        expect(asked).toBe(1);
        expect(held.header()).toBe(first);
        answer = async () => ticket(now + HOUR, 'b');
        await advance(2);
        expect(asked).toBe(2);
        expect(held.header()).not.toBe(first);
    });

    test('renews itself with no request at all, hour after hour', async () => {
        const held = tickets();
        held.subscribe(() => {});
        await advance(0);
        for (let hour = 0; hour < 5; hour++) {
            answer = async () => ticket(now + HOUR, String(hour));
            await advance(HOUR - 5 * 60_000);
        }
        expect(asked).toBe(6);
        expect(held.state().state).toBe('ready');
    });

    test('a ticket that ends with nobody renewing it is none, and the first request after it asks again', async () => {
        const held = tickets();
        await held.ensure();
        now += HOUR + 1;
        answer = async () => ticket(now + HOUR, 'c');
        expect(held.header()).toBeNull();
        await settle();
        expect(held.header()).toStartWith('Bearer ');
        expect(asked).toBe(2);
    });

    test('a failed renewal keeps the ticket until it really ends, and tries again after a minute, then two', async () => {
        const held = tickets();
        held.subscribe(() => {});
        await advance(0);
        const first = held.header();
        answer = async () => {
            throw new Error('offline');
        };
        await advance(HOUR - 5 * 60_000);
        expect(asked).toBe(2);
        expect(held.header()).toBe(first);
        expect(held.state().state).toBe('ready');
        await advance(60_000);
        expect(asked).toBe(3);
        // The second failure in a row waits twice as long.
        answer = async () => ticket(now + HOUR, 'd');
        await advance(60_000);
        expect(asked).toBe(3);
        await advance(60_000);
        expect(asked).toBe(4);
        expect(held.header()).not.toBe(first);
        expect(held.header()).toStartWith('Bearer ');
    });

    test('the ticket ends in the open when no renewal got through', async () => {
        const held = tickets();
        const states: string[] = [];
        held.subscribe(() => states.push(held.state().state));
        await advance(0);
        answer = async () => {
            throw new Error('offline');
        };
        await advance(HOUR + 1);
        expect(held.header()).toBeNull();
        expect(states).toContain('failed');
        expect(held.state().state).toBe('failed');
    });

    test('a failed first ask is repeated by a timer, not only by the next map', async () => {
        answer = async () => {
            throw new Error('offline');
        };
        const held = tickets();
        held.subscribe(() => {});
        await advance(0);
        expect(held.state()).toEqual({ state: 'failed', since: now });
        for (let i = 0; i < 20; i++) {
            await held.ensure();
        }
        expect(asked).toBe(1);
        answer = async () => ticket(now + HOUR);
        await advance(60_000);
        expect(asked).toBe(2);
        expect(held.state().state).toBe('ready');
    });

    test('asks nothing and runs no timer while inactive or unheard, and drops the ticket going inactive', async () => {
        const held = tickets();
        held.setIdentity(null);
        held.subscribe(() => {});
        await held.ensure();
        expect(held.header()).toBeNull();
        expect(asked).toBe(0);
        expect(timers).toEqual([]);
        held.setIdentity('');
        await advance(0);
        expect(asked).toBe(1);
        held.setIdentity(null);
        expect(held.state().state).toBe('none');
        expect(timers).toEqual([]);

        const alone = tickets();
        await alone.ensure();
        expect(timers).toEqual([]);
    });

    test('tells a listener when the state changes, and forgets the ticket on request', async () => {
        const held = tickets();
        const states: string[] = [];
        const stop = held.subscribe(() => states.push(held.state().state));
        await advance(0);
        held.setIdentity(null);
        stop();
        expect(states).toEqual(['ready', 'none']);
        expect(held.header()).toBeNull();
        expect(timers).toEqual([]);
    });
});

describe('a clock that is wrong', () => {
    const serverNow = (): number => now;

    function stamped(issuedAt: number, mark = 'a'): MapsTicket {
        return { ...ticket(issuedAt + HOUR, mark), issuedAt };
    }

    test('hours ahead of the address book still gets a ticket that lasts, renewed once near its end and never in a loop', async () => {
        const ahead = 3 * HOUR;
        const skewed = new MapTickets({
            fetchTicket: () => {
                asked++;
                return Promise.resolve(stamped(serverNow()));
            },
            now: () => now + ahead,
            timers: {
                after: (run, ms) => {
                    const id = nextTimer++;
                    timers.push({ at: now + ms, run, id });
                    return id;
                },
                cancel: (handle) => {
                    timers = timers.filter((timer) => timer.id !== handle);
                }
            }
        });
        skewed.subscribe(() => {});
        await advance(0);
        expect(asked).toBe(1);
        expect(skewed.header()).toStartWith('Bearer ');
        await advance(HOUR - 5 * 60_000 - 1);
        expect(asked).toBe(1);
        expect(skewed.header()).toStartWith('Bearer ');
        await advance(2);
        expect(asked).toBe(2);
        expect(skewed.header()).toStartWith('Bearer ');
    });

    test('behind the address book, a ticket does not outlive what it lasts', async () => {
        const behind = new MapTickets({
            fetchTicket: () => Promise.resolve(stamped(now + 3 * HOUR)),
            now: () => now,
            timers: { after: () => 0, cancel: () => {} }
        });
        await behind.ensure();
        expect(behind.header()).toStartWith('Bearer ');
        now += HOUR + 1;
        expect(behind.header()).toBeNull();
    });

    test('a ticket that arrives almost over is renewed no sooner than half a minute later, not at once', async () => {
        answer = async () => ({ ...ticket(now + 1_000), issuedAt: now });
        const held = tickets();
        held.subscribe(() => {});
        await advance(0);
        expect(asked).toBe(1);
        await advance(29_000);
        expect(asked).toBe(1);
        await advance(2_000);
        expect(asked).toBe(2);
    });

    test('an address book that says nothing of its clock gets the hour a ticket lasts', async () => {
        const held = tickets();
        await held.ensure();
        now += HOUR - 1;
        expect(held.header()).toStartWith('Bearer ');
        now += 2;
        expect(held.header()).toBeNull();
    });
});

describe('the account a ticket belongs to', () => {
    test('a ticket still being asked for when the account changes is thrown away, and the new account asks for its own', async () => {
        let release: (value: MapsTicket) => void = () => {};
        answer = () =>
            new Promise<MapsTicket>((resolve) => {
                release = resolve;
            });
        const held = tickets();
        held.setIdentity('account-1');
        void held.ensure();
        answer = async () => ticket(now + HOUR, 'y');
        held.setIdentity('account-2');
        release(ticket(now + HOUR, 'x'));
        await settle();
        expect(held.state().state).toBe('none');
        // Reading a header starts the new account's own ask.
        expect(held.header()).toBeNull();
        await held.ensure();
        expect(held.header()).toContain('y'.repeat(43));
        expect(held.header()).not.toContain('x'.repeat(43));
        expect(asked).toBe(2);
    });

    test('a ticket in flight when the source goes inactive is not kept, and no header is given while inactive', async () => {
        let release: (value: MapsTicket) => void = () => {};
        answer = () =>
            new Promise<MapsTicket>((resolve) => {
                release = resolve;
            });
        const held = tickets();
        held.setIdentity('account-1');
        void held.ensure();
        held.setIdentity(null);
        release(ticket(now + HOUR, 'x'));
        await settle();
        expect(held.header()).toBeNull();
        held.setIdentity('account-1');
        expect(held.header()).toBeNull();
        expect(held.state().state).toBe('none');
    });

    test('a ticket held is dropped when another account signs in, and a failure of the old ask does not hold the new one off', async () => {
        const held = tickets();
        held.setIdentity('account-1');
        await held.ensure();
        const first = held.header();
        expect(first).not.toBeNull();
        let fail: () => void = () => {};
        answer = () =>
            new Promise<MapsTicket>((_resolve, reject) => {
                fail = () => reject(new Error('offline'));
            });
        held.setIdentity('account-2');
        expect(held.header()).toBeNull();
        void held.ensure();
        held.setIdentity('account-3');
        fail();
        await settle();
        answer = async () => ticket(now + HOUR, 'z');
        await held.ensure();
        expect(held.header()).toContain('z'.repeat(43));
    });

    test('the same account again is the same ticket', async () => {
        const held = tickets();
        held.setIdentity('account-1');
        await held.ensure();
        const first = held.header();
        held.setIdentity('account-1');
        expect(held.header()).toBe(first);
        expect(asked).toBe(1);
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
        held.setIdentity(null);
        expect(source.transformRequest!(`${MAPS_URL}/v1/style?theme=light`)).toEqual({ url: `${MAPS_URL}/v1/style?theme=light` });
    });
});
