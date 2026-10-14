import { useSecrets } from '@/state/secrets';
import { pool } from '@/transport';
import { watchPool, type WatchablePool } from '@/transport/pool-watch';

/*
 * The secret cards of every machine this client holds a socket for. The daemon tells every socket the
 * whole list whenever it changes; a socket that opens asks once.
 */
export function startSecretWatch(source: WatchablePool = pool): () => void {
    return watchPool(
        (link, endpointId) => ({
            onOpen: () => {
                // A failed ask leaves the cards as they were; the next open link asks again.
                link.request('secret.requests', {})
                    .then((result) => useSecrets.getState().setRequests(endpointId, result.requests))
                    .catch(() => undefined);
            },
            subscriptions: [
                link.on('secret.requests', (payload) => useSecrets.getState().setRequests(endpointId, payload.requests)),
                () => useSecrets.getState().forget(endpointId)
            ]
        }),
        source
    );
}
