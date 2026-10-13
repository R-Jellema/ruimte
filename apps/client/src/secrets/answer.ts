import { machineTransport } from '@/transport';

/*
 * A person's answer to a secret card, straight to the machine that asked. The value goes in this one
 * request and nowhere else: not through the action registry, not into a store, not into a log.
 * False when the card was gone already.
 */
export interface SecretAnswers {
    save(endpointId: string, requestId: string, value: string): Promise<boolean>;
    decline(endpointId: string, requestId: string): Promise<boolean>;
}

export const secretAnswers: SecretAnswers = {
    save: async (endpointId, requestId, value) => (await machineTransport(endpointId).request('secret.save', { requestId, value })).accepted,
    decline: async (endpointId, requestId) => (await machineTransport(endpointId).request('secret.decline', { requestId })).accepted
};
