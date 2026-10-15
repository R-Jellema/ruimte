import type { EndpointIdentity } from '../endpoint-id.ts';
import type { OutboxStore } from '../outbox/outbox.ts';
import { owedTargetsIn } from '../remote/connect-peer.ts';
import { PeerMachines } from '../remote/peer-machines.ts';
import { RemoteConnections, brokerDialer } from '../remote/remote-connections.ts';
import { RemoteStatus } from '../remote/remote-status.ts';
import type { MachineBundle } from './machine.ts';

/* The links this machine holds to the machines it works in, with what it remembers about them. */
export interface RemoteBundle {
    machines: PeerMachines;
    status: RemoteStatus;
    connections: RemoteConnections;
    /* Runs after the machine left its account and forgot what it held of it, for what is built after this bundle. */
    onLeave(listener: () => Promise<void> | void): void;
}

export interface RemoteInput {
    home: string;
    identity: EndpointIdentity;
    machine: MachineBundle;
    outbox: OutboxStore;
    later: {
        /* The broker this machine announces itself to, null when it uses none. */
        brokerUrl(): string | null;
    };
}

export async function wireRemote({ home, identity, machine, outbox, later }: RemoteInput): Promise<RemoteBundle> {
    const machines = new PeerMachines(home);
    await machines.load();
    const status = new RemoteStatus();
    const owedTargets = owedTargetsIn(outbox);
    const connections = new RemoteConnections({
        machines,
        pending: machine.pendingAdmissions,
        status,
        owed: (machineId) => owedTargets(machineId).length,
        dialer: brokerDialer({ signer: machine.peerKey, defaultBroker: () => later.brokerUrl(), label: () => identity.label })
    });
    const leaving: Array<() => Promise<void> | void> = [];
    // Another account's machines never vouched for this one: its key, the machines it knew and the statements it held go with the account.
    machine.auth.onLeft(async () => {
        connections.closeAll();
        machine.pendingAdmissions.clear();
        await machines.wipe();
        await machine.peerKey.wipe();
        for (const listener of leaving) {
            await listener();
        }
    });
    return { machines, status, connections, onLeave: (listener) => void leaving.push(listener) };
}
