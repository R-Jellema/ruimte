import { signalMessage, type SignalEnvelope } from '@ruimte/pulsar';
import { signMessage } from '../auth/keys.ts';
import type { ConnectionServices } from '../connection.ts';
import type { Dispatcher } from '../dispatcher.ts';

export const OFFER: SignalEnvelope = { connectionId: 'attempt-0001', signal: { kind: 'offer', sdp: 'v=0\r\na=fingerprint:sha-256 AA' } };

/** The fields of a signal frame `from` sends to `to`, signed by `signer` (another key makes the signature wrong). */
export function signedSignal(from: { publicKey: string; privateKey: string }, to: string, envelope: SignalEnvelope, signer = from) {
    return {
        from: from.publicKey,
        envelope,
        signature: signMessage(signer.privateKey, signalMessage(from.publicKey, to, envelope))
    };
}

const noSource = { subscribe: () => () => undefined, detachAll: () => undefined };

/** The services of a connection with nothing to subscribe to, so a channel only reaches `dispatcher`. */
export function servicesWith(dispatcher: Dispatcher): ConnectionServices {
    return {
        dispatcher,
        sessions: { ...noSource, get: () => undefined },
        chats: noSource,
        identity: noSource,
        projects: noSource,
        drawings: noSource,
        diagrams: noSource,
        folders: noSource,
        statuses: noSource,
        usage: noSource,
        limits: noSource,
        processes: noSource
    } as unknown as ConnectionServices;
}
