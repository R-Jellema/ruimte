import type { Transport } from '@/transport/transport';
import { markPeerLapsed } from '@/project/peer-lapse';

type Requester = Pick<Transport, 'request'>;
type PeerLinker = (machineId: string, self: Requester) => Promise<void>;

// Loaded on use; the account code reaches back into the transport the callers are drawn from.
const throughAccount: PeerLinker = async (machineId, self) => (await import('@/pulsar/peer-link')).linkPeerThroughAccount(machineId, self);

let linker = throughAccount;

/* Lets this machine work in `machineId`, with the account of this window vouching for it. */
export function linkToPeer(machineId: string, self: Requester): Promise<void> {
    return linker(machineId, self);
}

/*
 * The same for a link that is made along the way: a refusal is no error for the caller, it only marks
 * the machine so its nodes offer the way back.
 */
export async function linkToPeerOrMark(machineId: string, self: Requester): Promise<boolean> {
    try {
        await linkToPeer(machineId, self);
        markPeerLapsed(machineId, false);
        return true;
    } catch {
        markPeerLapsed(machineId, true);
        return false;
    }
}

/* For tests: stands in for the account; the returned function puts the real one back. */
export function swapPeerLinker(next: PeerLinker): () => void {
    linker = next;
    return () => {
        linker = throughAccount;
    };
}
