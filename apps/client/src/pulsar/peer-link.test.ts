import { describe, expect, test } from 'bun:test';
import type { PeerAccessRequestPayload, PeerStatement } from '@ruimte/pulsar';
import { linkPeer } from './peer-link';

const SIGNED = { peerMachineId: 'machine-a', peerPublicKey: 'P'.repeat(43), peerSignature: 'p'.repeat(86), machineSignature: 'm'.repeat(86) };

function statementFor(payload: PeerAccessRequestPayload, patch: Partial<PeerStatement> = {}): PeerStatement {
    return {
        machineId: payload.machineId,
        machinePublicKey: 'B'.repeat(43),
        accountId: 'owner',
        peerPublicKey: payload.peerPublicKey,
        peerMachineId: payload.peerMachineId,
        peerMachinePublicKey: 'A'.repeat(43),
        nonce: payload.nonce,
        issuedAt: 1,
        expiresAt: 2,
        signature: 's'.repeat(86),
        ...patch
    };
}

function rig() {
    const calls: Array<{ type: string; payload: unknown }> = [];
    const self = {
        request: async (type: string, payload: unknown) => {
            calls.push({ type, payload });
            return type === 'endpoint.signPeerAccess' ? SIGNED : {};
        }
    };
    return { calls, self: self as never };
}

describe('linking this machine to work in another one', () => {
    test('has this machine sign, the address book vouch and the statement go back to this machine with the broker the account lists', async () => {
        const { calls, self } = rig();
        const posted: PeerAccessRequestPayload[] = [];
        await linkPeer({
            machineId: 'machine-b',
            self,
            brokerUrl: 'wss://broker.example.com',
            request: async (payload) => {
                posted.push(payload);
                return statementFor(payload);
            }
        });
        expect(calls.map((call) => call.type)).toEqual(['endpoint.signPeerAccess', 'remote.connect']);
        expect(posted[0]).toMatchObject({ machineId: 'machine-b', ...SIGNED });
        expect(posted[0]!.nonce).toBe((calls[0]!.payload as { nonce: string }).nonce);
        expect(calls[1]!.payload).toMatchObject({ machineId: 'machine-b', brokerUrl: 'wss://broker.example.com', statement: { machineId: 'machine-b' } });
    });

    test('names no broker when the account lists none', async () => {
        const { calls, self } = rig();
        await linkPeer({ machineId: 'machine-b', self, brokerUrl: null, request: async (payload) => statementFor(payload) });
        expect(calls[1]!.payload).not.toHaveProperty('brokerUrl');
    });

    test('hands over nothing for a statement that is for something else than what was asked', async () => {
        for (const patch of [{ machineId: 'machine-c' }, { nonce: 'x'.repeat(22) }, { peerPublicKey: 'Q'.repeat(43) }, { peerMachineId: 'machine-z' }]) {
            const { calls, self } = rig();
            await expect(
                linkPeer({ machineId: 'machine-b', self, brokerUrl: null, request: async (payload) => statementFor(payload, patch) })
            ).rejects.toThrow();
            expect(calls.map((call) => call.type)).toEqual(['endpoint.signPeerAccess']);
        }
    });
});
