import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { UiMapSource } from '@adecore/agents-react';
import { usePulsarAccount, withAccessToken } from '@/pulsar/account';
import { useSettings } from '@/state/settings';
import { MapTickets, mapSourceFor } from '@/chat/map-source';

const tickets = new MapTickets({
    fetchTicket: () => withAccessToken((client, token) => client.mapsTicket(token)),
    now: () => Date.now()
});

/*
 * The tile source of the maps in a chat, from the "Map tiles" setting and the account this client is signed in
 * to. The ticket is the account's, not the machine's, so the scope a chat belongs to makes no difference here.
 */
export function useMapSource(_scopeId: string): UiMapSource {
    const enabled = useSettings((s) => s.chatMapTiles);
    const signedIn = usePulsarAccount((s) => s.status === 'signed-in');
    const held = useSyncExternalStore(
        (listener) => tickets.subscribe(listener),
        () => tickets.state()
    );
    useEffect(() => {
        if (enabled && signedIn) {
            void tickets.ensure();
        } else if (!signedIn) {
            tickets.clear();
        }
    }, [enabled, signedIn]);
    return useMemo(() => mapSourceFor({ enabled, signedIn, tickets: { header: () => tickets.header(), state: () => held } }), [enabled, signedIn, held]);
}
