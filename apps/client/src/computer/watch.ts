import i18next from 'i18next';
import { useComputer } from '@/state/computer';
import { pool } from '@/transport';
import { watchPool, type WatchablePool } from '@/transport/pool-watch';

/*
 * The computer use cards, status and grants of every machine this client holds a socket for. The daemon
 * tells every socket the whole of each whenever it changes; a socket that opens asks once.
 * A machine with computer use on hears when the interface language changes, so its overlay speaks it.
 */
export function startComputerWatch(source: WatchablePool = pool): () => void {
    return watchPool((link, endpointId) => {
        let language = i18next.language;
        const onLanguage = (next: string): void => {
            // A region change redraws with the same language, which the overlay does not need to hear.
            if (next === language) {
                return;
            }
            language = next;
            if (useComputer.getState().statuses[endpointId]?.enabled) {
                // A failed ask keeps the words the overlay has.
                link.request('computer.setLanguage', { language: next }).catch(() => undefined);
            }
        };
        i18next.on('languageChanged', onLanguage);
        return {
            onOpen: () => {
                // A failed ask leaves the cards and the status as they were; the next open link asks again.
                link.request('computer.approvals', {})
                    .then((result) => useComputer.getState().setApprovals(endpointId, result.approvals))
                    .catch(() => undefined);
                link.request('computer.status', {})
                    .then((status) => useComputer.getState().setStatus(endpointId, status))
                    .catch(() => undefined);
                link.request('computer.grants', {})
                    .then((grants) => useComputer.getState().setGrants(endpointId, grants))
                    .catch(() => undefined);
            },
            subscriptions: [
                link.on('computer.approvals', (payload) => useComputer.getState().setApprovals(endpointId, payload.approvals)),
                link.on('computer.status', (payload) => useComputer.getState().setStatus(endpointId, payload)),
                link.on('computer.grants', (payload) => useComputer.getState().setGrants(endpointId, payload)),
                () => i18next.off('languageChanged', onLanguage),
                () => useComputer.getState().forget(endpointId)
            ]
        };
    }, source);
}
