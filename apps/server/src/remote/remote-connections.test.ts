import { beforeEach, describe, expect, test } from 'bun:test';
import type { PeerStatement } from '@ruimte/pulsar';
import type { SessionEvent } from '../sessions/manager.ts';
import type { PeerLink } from './peer-connection.ts';
import type { PeerMachine } from './peer-machines.ts';
import { PendingAdmissions } from './pending-admissions.ts';
import { RemoteConnections, type PeerDialer } from './remote-connections.ts';
import { RemoteStatus } from './remote-status.ts';

const MACHINE: PeerMachine = { machineId: 'machine-b', publicKey: 'B'.repeat(43), linkedAt: 1 };

class FakeLink implements PeerLink {
    closed = false;
    private lost: Array<() => void> = [];

    async request<T>(): Promise<T> {
        return undefined as T;
    }

    onFrame(): () => void {
        return () => undefined;
    }

    onLost(listener: () => void): void {
        this.lost.push(listener);
    }

    close(): void {
        this.closed = true;
    }

    drop(): void {
        for (const listener of this.lost) {
            listener();
        }
    }
}

function statement(): PeerStatement {
    return {
        machineId: 'machine-b',
        machinePublicKey: MACHINE.publicKey,
        accountId: 'owner',
        peerPublicKey: 'P'.repeat(43),
        peerMachineId: 'machine-a',
        peerMachinePublicKey: 'A'.repeat(43),
        nonce: 'n'.repeat(22),
        issuedAt: 1000,
        expiresAt: 601_000,
        signature: 's'.repeat(86)
    };
}

let known: PeerMachine | null;
let owed: number;
let dials: Array<PeerStatement | null>;
let next: Promise<PeerLink> | (() => Promise<PeerLink>);
let status: RemoteStatus;
let pending: PendingAdmissions;
let connections: RemoteConnections;
let heard: string[];

beforeEach(() => {
    known = MACHINE;
    owed = 0;
    dials = [];
    heard = [];
    status = new RemoteStatus();
    pending = new PendingAdmissions(() => 2000);
    status.subscribe('client-1', (event: SessionEvent) => {
        if (event.event === 'remote.status') {
            heard.push(`${event.payload.state}:${event.payload.owed}`);
        }
    });
    const dialer: PeerDialer = {
        dial: (_machine, offered) => {
            dials.push(offered);
            return typeof next === 'function' ? next() : next;
        }
    };
    connections = new RemoteConnections({ machines: { get: () => known }, pending, dialer, status, owed: () => owed });
    next = async () => new FakeLink();
});

describe('the links to other machines', () => {
    test('opens one, offers the pending statement and drops it once the machine let the key in', async () => {
        pending.hold(statement());
        const link = await connections.connect('machine-b');
        expect(dials).toEqual([statement()]);
        expect(connections.isOpen('machine-b')).toBe(true);
        expect(connections.link('machine-b')).toBe(link);
        expect(pending.peek('machine-b')).toBeNull();
        expect(heard).toEqual(['connecting:0', 'open:0']);
    });

    test('hands the open link out without dialing again, and shares one attempt between callers', async () => {
        const [one, two] = await Promise.all([connections.connect('machine-b'), connections.connect('machine-b')]);
        expect(one).toBe(two);
        expect(await connections.connect('machine-b')).toBe(one);
        expect(dials).toHaveLength(1);
    });

    test('keeps the statement for the next try when the attempt failed, and says nothing is wrong while nothing waits on it', async () => {
        pending.hold(statement());
        next = async () => {
            throw new Error('The machine did not answer');
        };
        await expect(connections.connect('machine-b')).rejects.toThrow('did not answer');
        expect(pending.peek('machine-b')).not.toBeNull();
        expect(connections.isOpen('machine-b')).toBe(false);
        expect(heard).toEqual(['connecting:0', 'closed:0']);
    });

    test('says the link is waiting when it failed while work for the machine is owed', async () => {
        owed = 2;
        next = async () => {
            throw new Error('The machine did not answer');
        };
        await expect(connections.connect('machine-b')).rejects.toThrow();
        expect(heard).toEqual(['connecting:2', 'waiting:2']);
        connections.waiting('machine-b', 5000);
        expect(status.get('machine-b')).toEqual({ machineId: 'machine-b', state: 'waiting', owed: 2, nextAttemptAt: 5000 });
    });

    test('names the broker of a machine that has one of its own in the standing, and the next try when it waits', async () => {
        known = { ...MACHINE, brokerUrl: 'wss://broker.example.com' };
        owed = 1;
        await connections.connect('machine-b');
        expect(status.get('machine-b')).toEqual({ machineId: 'machine-b', state: 'open', owed: 1, brokerUrl: 'wss://broker.example.com' });
        connections.waiting('machine-b', 9000);
        expect(status.get('machine-b')).toMatchObject({ state: 'waiting', nextAttemptAt: 9000, brokerUrl: 'wss://broker.example.com' });
    });

    test('refuses a machine that was never linked, without dialing', async () => {
        known = null;
        await expect(connections.connect('machine-b')).rejects.toMatchObject({ code: 'unknown-machine' });
        expect(dials).toEqual([]);
    });

    test('a lost link is dropped, closed and reported to whoever owes work to the machine', async () => {
        owed = 1;
        const lost: string[] = [];
        connections.onLost((machineId) => lost.push(machineId));
        const link = (await connections.connect('machine-b')) as FakeLink;
        link.drop();
        link.drop();
        expect(lost).toEqual(['machine-b']);
        expect(link.closed).toBe(true);
        expect(connections.isOpen('machine-b')).toBe(false);
        expect(heard.at(-1)).toBe('waiting:1');
    });

    test('closing on purpose is not a loss', async () => {
        const lost: string[] = [];
        connections.onLost((machineId) => lost.push(machineId));
        const link = (await connections.connect('machine-b')) as FakeLink;
        connections.close('machine-b');
        expect(link.closed).toBe(true);
        expect(lost).toEqual([]);
        expect(heard.at(-1)).toBe('closed:0');
        expect(status.get('machine-b')).toBeNull();
    });
});

describe('the standing of the links', () => {
    test('tells a client that subscribes later what stands now, and tells the clients only of a change', () => {
        status.set({ machineId: 'machine-b', state: 'open', owed: 0 });
        status.set({ machineId: 'machine-b', state: 'open', owed: 0 });
        expect(heard).toEqual(['open:0']);
        const late: string[] = [];
        status.subscribe('client-2', (event: SessionEvent) => {
            if (event.event === 'remote.status') {
                late.push(`${event.payload.machineId}:${event.payload.state}`);
            }
        });
        expect(late).toEqual(['machine-b:open']);
    });
});
