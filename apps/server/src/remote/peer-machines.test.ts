import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PeerMachines } from './peer-machines.ts';

let home: string;

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-peer-machines-'));
});

afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

describe('the machines this one works in', () => {
    test('are remembered with their key and broker across a restart', async () => {
        const machines = new PeerMachines(home);
        await machines.put({ machineId: 'machine-b', publicKey: 'B'.repeat(43), brokerUrl: 'wss://broker.example.com' }, 10);
        const fresh = new PeerMachines(home);
        await fresh.load();
        expect(fresh.get('machine-b')).toEqual({ machineId: 'machine-b', publicKey: 'B'.repeat(43), brokerUrl: 'wss://broker.example.com', linkedAt: 10 });
        expect(fresh.get('machine-c')).toBeNull();
    });

    test('keep when they were first linked when a new statement names another key, and are forgotten on request', async () => {
        const machines = new PeerMachines(home);
        await machines.put({ machineId: 'machine-b', publicKey: 'B'.repeat(43) }, 10);
        expect(await machines.put({ machineId: 'machine-b', publicKey: 'C'.repeat(43) }, 99)).toMatchObject({ publicKey: 'C'.repeat(43), linkedAt: 10 });
        await machines.remove('machine-b');
        expect(machines.get('machine-b')).toBeNull();
        expect(machines.all()).toEqual([]);
    });

    test('ignore a file whose key is not a key', async () => {
        await Bun.write(join(home, 'peer-machines', 'machine-x.json'), JSON.stringify({ machineId: 'machine-x', publicKey: 'nope', linkedAt: 1 }));
        const machines = new PeerMachines(home);
        await machines.load();
        expect(machines.get('machine-x')).toBeNull();
    });
});
