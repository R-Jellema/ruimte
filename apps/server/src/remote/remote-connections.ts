import type { RemoteStatusEvent } from '@ruimte/contracts';
import type { PeerStatement } from '@ruimte/pulsar';
import { CodedError } from '@adecore/agents';
import { PEER_ATTEMPT_TIMEOUT_MS, openBrokerLine, openPeerLink, type PeerLink, type PeerSigner } from './peer-connection.ts';
import type { PeerMachine, PeerMachines } from './peer-machines.ts';
import type { PendingAdmissions } from './pending-admissions.ts';
import type { RemoteStatus } from './remote-status.ts';

export class RemoteLinkError extends CodedError<'unknown-machine' | 'no-broker' | 'unreachable' | 'refused'> {}

/*
 * What the other machine says when it will not have this one: it does not know the key (never let in, run
 * out or revoked), refuses the statement, or runs another protocol. Trying again changes none of that.
 */
export function refusedByMachine(error: unknown): boolean {
    const message = error instanceof Error ? error.message : '';
    return /closed the attempt: (not-paired|statements-refused)|does not know this device|different versions of Ruimte/.test(message);
}

/* Opens a link to one machine; rejects with the reason it could not. */
export interface PeerDialer {
    dial(machine: PeerMachine, statement: PeerStatement | null): Promise<PeerLink>;
}

export interface BrokerDialerOptions {
    signer: PeerSigner;
    /* The broker this machine uses itself, for a machine whose own broker is not known. */
    defaultBroker(): string | null;
    /* What the other machine calls this one. */
    label(): string;
    timeoutMs?: number;
}

/* The production dialer: the broker for the signals, then a direct channel for everything else. */
export function brokerDialer(options: BrokerDialerOptions): PeerDialer {
    return {
        async dial(machine, statement) {
            const url = machine.brokerUrl ?? options.defaultBroker();
            if (url === null || url === undefined) {
                throw new RemoteLinkError('no-broker', 'Neither machine has a broker set, so they cannot find each other');
            }
            const timeoutMs = options.timeoutMs ?? PEER_ATTEMPT_TIMEOUT_MS;
            const line = await openBrokerLine({ url, signer: options.signer, machinePublicKey: machine.publicKey, timeoutMs });
            try {
                return await openPeerLink({ line, signer: options.signer, machine, label: options.label(), statement, timeoutMs });
            } catch (e) {
                line.close();
                throw e;
            }
        }
    };
}

export interface RemoteConnectionsOptions {
    machines: Pick<PeerMachines, 'get'>;
    pending: Pick<PendingAdmissions, 'peek' | 'release'>;
    dialer: PeerDialer;
    status: RemoteStatus;
    /* How many pieces of work wait on the link to that machine. */
    owed(machineId: string): number;
    /* The nodes whose task that machine has not been asked to start yet; `except` is an entry that is done and about to go. */
    unstarted(machineId: string, except?: string): string[];
}

/*
 * The links this machine holds to machines it works in, one at most per machine. A link that fails or
 * is lost says so to the clients only while work waits on it: a link nothing is owed for just closes,
 * and the reconnect (`connect-peer.ts`) is what keeps trying while something is.
 */
export class RemoteConnections {
    private readonly options: RemoteConnectionsOptions;
    private readonly links = new Map<string, PeerLink>();
    private readonly attempts = new Map<string, Promise<PeerLink>>();
    private readonly lostListeners = new Set<(machineId: string) => void>();
    private readonly frameListeners = new Set<(machineId: string, raw: string) => void>();

    constructor(options: RemoteConnectionsOptions) {
        this.options = options;
    }

    isOpen(machineId: string): boolean {
        return this.links.has(machineId);
    }

    knows(machineId: string): boolean {
        return this.options.machines.get(machineId) !== null;
    }

    /* The open link to a machine, or null while there is none. */
    link(machineId: string): PeerLink | null {
        return this.links.get(machineId) ?? null;
    }

    /* Told when an open link goes, so whatever owes work to that machine can ask for a reconnect. */
    onLost(listener: (machineId: string) => void): void {
        this.lostListeners.add(listener);
    }

    /* Told of every frame a machine sends that is no reply to a request, such as word that a task of it settled. */
    onFrame(listener: (machineId: string, raw: string) => void): void {
        this.frameListeners.add(listener);
    }

    /* Resolves once the link is open, at once when it already is; one attempt serves everyone who asks while it runs. */
    async connect(machineId: string): Promise<PeerLink> {
        const open = this.links.get(machineId);
        if (open !== undefined) {
            return open;
        }
        const running = this.attempts.get(machineId);
        if (running !== undefined) {
            return running;
        }
        const attempt = this.dial(machineId).finally(() => this.attempts.delete(machineId));
        this.attempts.set(machineId, attempt);
        return attempt;
    }

    /* Closes the link on purpose, such as when the machine is unlinked; nobody is told it was lost. */
    close(machineId: string): void {
        this.links.get(machineId)?.close();
        this.links.delete(machineId);
        this.options.status.forget(machineId);
    }

    closeAll(): void {
        for (const machineId of [...this.links.keys()]) {
            this.close(machineId);
        }
    }

    /* The standing of a machine whose link is closed, as the clients see it. */
    idle(machineId: string): void {
        this.publish(machineId, this.links.has(machineId) ? 'open' : null);
    }

    /* A reconnect is due at `nextAttemptAt`. */
    waiting(machineId: string, nextAttemptAt: number): void {
        this.options.status.set({ ...this.standing(machineId, 'waiting'), nextAttemptAt });
    }

    /* Says again how many tasks wait, as the standing of a link that is already told of. `except` is an entry that is done. */
    refresh(machineId: string, except?: string): void {
        const held = this.options.status.get(machineId);
        if (held === null || held.state === 'closed') {
            return;
        }
        this.options.status.set(this.standing(machineId, held.state, except, held.nextAttemptAt));
    }

    private standing(machineId: string, state: 'open' | 'connecting' | 'waiting', except?: string, nextAttemptAt?: number): RemoteStatusEvent {
        const brokerUrl = this.options.machines.get(machineId)?.brokerUrl;
        const unstarted = this.options.unstarted(machineId, except);
        return {
            machineId,
            state,
            owed: this.options.owed(machineId),
            ...(nextAttemptAt === undefined ? {} : { nextAttemptAt }),
            ...(brokerUrl ? { brokerUrl } : {}),
            ...(unstarted.length === 0 ? {} : { unstartedNodeIds: unstarted })
        };
    }

    private async dial(machineId: string): Promise<PeerLink> {
        const machine = this.options.machines.get(machineId);
        if (machine === null) {
            throw new RemoteLinkError('unknown-machine', 'This machine was never linked to that one');
        }
        this.publish(machineId, 'connecting');
        const statement = this.options.pending.peek(machineId);
        let link: PeerLink;
        try {
            link = await this.options.dialer.dial(machine, statement);
        } catch (e) {
            const refused = refusedByMachine(e);
            this.publish(machineId, this.options.owed(machineId) > 0 && !refused ? 'waiting' : null);
            throw refused ? new RemoteLinkError('refused', e instanceof Error ? e.message : 'That machine refused this one') : e;
        }
        // The machine let this key in, so the statement has done what it was for.
        this.options.pending.release(machineId);
        this.links.set(machineId, link);
        link.onLost(() => this.lost(machineId, link));
        link.onFrame((raw) => {
            for (const listener of this.frameListeners) {
                listener(machineId, raw);
            }
        });
        this.publish(machineId, 'open');
        return link;
    }

    private lost(machineId: string, link: PeerLink): void {
        if (this.links.get(machineId) !== link) {
            return;
        }
        this.links.delete(machineId);
        link.close();
        this.publish(machineId, this.options.owed(machineId) > 0 ? 'waiting' : null);
        for (const listener of this.lostListeners) {
            listener(machineId);
        }
    }

    private publish(machineId: string, state: 'open' | 'connecting' | 'waiting' | null): void {
        if (state === null) {
            this.options.status.forget(machineId);
            return;
        }
        this.options.status.set(this.standing(machineId, state));
    }
}
