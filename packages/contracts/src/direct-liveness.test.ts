import { describe, expect, test } from 'bun:test';
import { ChannelLiveness, directPingFrame, type ChannelLivenessOptions } from './direct-liveness.ts';

function setup(options: Partial<ChannelLivenessOptions> = { idleMs: 2_000, timeoutMs: 5_000 }) {
    let clock = 0;
    const pings: string[] = [];
    let dead = 0;
    const liveness = new ChannelLiveness({
        ping: (id) => pings.push(id),
        dead: () => {
            dead += 1;
        },
        now: () => clock,
        ...options
    });

    return {
        liveness,
        pings,
        dead: () => dead,
        clock: () => clock,
        at: (ms: number) => {
            clock = ms;
            liveness.tick();
        }
    };
}

describe('ChannelLiveness', () => {
    test('a connection that keeps talking is never pinged', () => {
        const { liveness, pings, at } = setup();
        for (let ms = 500; ms <= 20_000; ms += 500) {
            liveness.heard();
            at(ms);
        }
        expect(pings).toEqual([]);
    });

    test('a quiet connection is pinged once, and an answer puts it back to quiet', () => {
        const { liveness, pings, dead, at } = setup();
        at(1_000);
        expect(pings).toEqual([]);
        at(2_000);
        at(3_000);
        expect(pings).toEqual(['alive-1']);
        liveness.heard();
        at(4_000);
        expect(pings).toEqual(['alive-1']);
        at(6_000);
        expect(pings).toEqual(['alive-1', 'alive-2']);
        expect(dead()).toBe(0);
    });

    test('nothing heard within the timeout of a ping is a dead peer', () => {
        const { dead, at } = setup();
        at(2_000);
        at(6_000);
        expect(dead()).toBe(0);
        at(7_000);
        expect(dead()).toBe(1);
    });

    test('a tick that comes a minute late sends a ping instead of calling the peer dead', () => {
        const { pings, dead, at } = setup();
        at(60_000);
        expect(pings).toEqual(['alive-1']);
        expect(dead()).toBe(0);
    });

    test('an answer stuck behind a burst is no dead peer while the transport still receives packets', () => {
        let received = 0;
        const { pings, dead, at, clock } = setup({ received: () => received });

        // The ordered stream delivers nothing for 20 seconds while SCTP recovers, but its packets keep arriving.
        for (let ms = 1_000; ms <= 20_000; ms += 1_000) {
            received += 1_200;
            at(ms);
        }

        expect(dead()).toBe(0);
        expect(pings).toEqual([]);

        // Then nothing at all: pinged after the idle time, and gone once the timeout passed without a byte.
        for (let ms = clock() + 1_000; ms <= 34_000 && dead() === 0; ms += 1_000) {
            at(ms);
        }

        expect(pings).toEqual(['alive-1']);
        expect(dead()).toBe(1);
    });

    test('a peer that stops sending is still called dead within tens of seconds', () => {
        const { dead, at, clock } = setup({ received: () => 5_000 });
        let deadAt: number | null = null;

        for (let ms = 0; ms <= 30_000 && deadAt === null; ms += 1_000) {
            at(ms);

            if (dead() > 0) {
                deadAt = clock();
            }
        }

        expect(deadAt).not.toBeNull();
        expect(deadAt!).toBeLessThanOrEqual(13_000);
    });

    test('the ping is a server.ping request under its own id', () => {
        expect(JSON.parse(directPingFrame('alive-3'))).toEqual({ id: 'alive-3', type: 'server.ping', payload: {} });
    });
});
