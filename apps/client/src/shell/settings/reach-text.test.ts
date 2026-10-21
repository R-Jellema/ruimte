import { describe, expect, test } from 'bun:test';
import type { ReachCheck } from '@ruimte/contracts';
import { reachText } from './reach-text';

function check(patch: Partial<ReachCheck>): ReachCheck {
    return {
        checkedAt: 0,
        cause: 'ok',
        severity: 'ok',
        facts: {
            broker: { url: 'wss://broker.ruimte.app', connected: true },
            granted: true,
            probes: [],
            lanDoor: { wanted: true, listening: true, port: 4220, addresses: 1 },
            tunnel: 'utun4'
        },
        ...patch
    };
}

describe('the reach row', () => {
    test('a reachable machine says so and needs no fix', () => {
        expect(reachText(check({}))).toEqual({ problem: 'Other devices reach this machine, directly or through the relay.', fix: null });
    });

    test('a VPN reads differently when the relay still carries the connection', () => {
        expect(reachText(check({ cause: 'vpn-blocks-udp', severity: 'relayed' })).problem).toBe(
            'Traffic leaves through utun4, a VPN or exit node that drops UDP, so connections only work through the relay over TCP.'
        );
        expect(reachText(check({ cause: 'vpn-blocks-udp', severity: 'unreachable' })).problem).toBe(
            'Traffic leaves through utun4, a VPN or exit node that drops UDP, so other devices cannot connect.'
        );
    });

    test('the broker is named by its host', () => {
        expect(reachText(check({ cause: 'broker-unreachable', severity: 'unreachable' })).problem).toContain('the broker at broker.ruimte.app');
    });

    test('a cause a newer machine names is told as it is, without a fix', () => {
        expect(reachText(check({ cause: 'carrier-pigeon', severity: 'limited' }))).toEqual({
            problem: 'The machine reports carrier-pigeon, which this version of Ruimte does not know yet.',
            fix: null
        });
    });
});
