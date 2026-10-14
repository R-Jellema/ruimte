import { MAPS_URL, type MapsTicket } from '@ruimte/pulsar';
import type { UiMapSource } from '@adecore/agents-react';

// A ticket is asked for again this long before it ends, so a map being panned never meets the end of one.
const REFRESH_MARGIN_MS = 5 * 60_000;

// After a failed ask the next one waits, so a service that is down is not asked for with every tile.
const RETRY_AFTER_FAILURE_MS = 60_000;

export type MapTicketState = { state: 'none' } | { state: 'ready'; ticket: MapsTicket } | { state: 'failed'; since: number };

export interface MapTicketsOptions {
    /* One ask of the address book for a ticket, with the session of the person signed in. */
    fetchTicket(): Promise<MapsTicket>;
    now(): number;
}

/*
 * The ticket the maps service accepts, held and renewed for every map on the page. A tile asks for
 * `header()` on each request, which is a read; the fetch happens at most once at a time, a little before
 * the ticket ends.
 */
export class MapTickets {
    private readonly options: MapTicketsOptions;
    private current: MapTicketState = { state: 'none' };
    private pending: Promise<void> | null = null;
    private readonly listeners = new Set<() => void>();

    constructor(options: MapTicketsOptions) {
        this.options = options;
    }

    state(): MapTicketState {
        return this.current;
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /* Asks for a ticket when there is none, it is about to end or the last ask failed long enough ago. */
    ensure(): Promise<void> {
        const held = this.current;
        const now = this.options.now();
        const fresh = held.state === 'ready' && held.ticket.expiresAt - REFRESH_MARGIN_MS > now;
        const waiting = held.state === 'failed' && now - held.since < RETRY_AFTER_FAILURE_MS;
        if (fresh || waiting) {
            return this.pending ?? Promise.resolve();
        }
        this.pending ??= this.options
            .fetchTicket()
            .then(
                (ticket) => this.set({ state: 'ready', ticket }),
                () => this.set({ state: 'failed', since: this.options.now() })
            )
            .finally(() => {
                this.pending = null;
            });
        return this.pending;
    }

    /* The `authorization` header of a request to the maps service, or null when no ticket is held; a held ticket past its end counts as none. */
    header(): string | null {
        const held = this.current;
        if (held.state !== 'ready' || held.ticket.expiresAt <= this.options.now()) {
            return null;
        }
        void this.ensure();
        return `Bearer ${held.ticket.ticket}`;
    }

    /* Forgets the ticket, such as on signing out, so the next map asks as whoever signs in next. */
    clear(): void {
        this.set({ state: 'none' });
    }

    private set(next: MapTicketState): void {
        this.current = next;
        for (const listener of this.listeners) {
            listener();
        }
    }
}

export interface MapSourceInput {
    /* The "Map tiles" setting. */
    enabled: boolean;
    signedIn: boolean;
    tickets: Pick<MapTickets, 'header'> & { state(): MapTicketState };
}

const MAPS_ORIGIN = new URL(MAPS_URL).origin;

/* The request, with the ticket in a header when it goes to the maps service and nowhere else. */
function transformRequest(url: string, header: () => string | null): { url: string; headers?: Record<string, string> } {
    let origin: string;
    try {
        origin = new URL(url).origin;
    } catch {
        return { url };
    }
    const authorization = origin === MAPS_ORIGIN ? header() : null;
    return authorization === null ? { url } : { url, headers: { authorization } };
}

/*
 * What a chat map draws with: Ruimte's tiles while the setting is on, a person is signed in and a ticket is
 * held, and the reason it is not otherwise. A ticket that is still being asked for reads as `unavailable`, so
 * the map starts as the outline and takes the tiles when they can be had.
 */
export function mapSourceFor({ enabled, signedIn, tickets }: MapSourceInput): UiMapSource {
    if (!enabled) {
        return { state: 'off', reason: 'disabled' };
    }
    if (!signedIn) {
        return { state: 'off', reason: 'signed-out' };
    }
    if (tickets.state().state !== 'ready') {
        return { state: 'off', reason: 'unavailable' };
    }
    return {
        state: 'tiles',
        styleUrl: (theme) => `${MAPS_URL}/v1/style?theme=${theme}`,
        transformRequest: (url) => transformRequest(url, () => tickets.header()),
        // Orbis tiles carry every translation as `name_<language>`.
        labelField: (language) => `name_${language}`,
        attribution: '© TomTom'
    };
}
