import { signalMessage, type SignalEnvelope } from '@ruimte/pulsar';
import { signMessage } from '../auth/keys.ts';

export const OFFER: SignalEnvelope = { connectionId: 'attempt-0001', signal: { kind: 'offer', sdp: 'v=0\r\na=fingerprint:sha-256 AA' } };

/** The fields of a signal frame `from` sends to `to`, signed by `signer` (another key makes the signature wrong). */
export function signedSignal(from: { publicKey: string; privateKey: string }, to: string, envelope: SignalEnvelope, signer = from) {
    return {
        from: from.publicKey,
        envelope,
        signature: signMessage(signer.privateKey, signalMessage(from.publicKey, to, envelope))
    };
}
