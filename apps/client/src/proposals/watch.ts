import { useProposals } from '@/state/proposals';
import { pool } from '@/transport';
import { machineAnswers } from '@/transport/features';
import { watchPool, type WatchablePool } from '@/transport/pool-watch';

/*
 * The project suggestions of every machine this client holds a socket for. The machine tells every
 * socket the whole list whenever it changes; a socket that opens asks once, unless the machine is
 * older than the request.
 */
export function startProposalWatch(source: WatchablePool = pool): () => void {
    return watchPool(
        (link, endpointId) => ({
            onOpen: () => {
                if (!machineAnswers(link.connection, 'chat.proposals')) {
                    return;
                }
                // A failed ask leaves the cards as they were; the next open link asks again.
                link.request('chat.proposals', {})
                    .then((result) => useProposals.getState().setProposals(endpointId, result.proposals))
                    .catch(() => undefined);
            },
            subscriptions: [
                link.on('chat.proposals', (payload) => useProposals.getState().setProposals(endpointId, payload.proposals)),
                () => useProposals.getState().forget(endpointId)
            ]
        }),
        source
    );
}
