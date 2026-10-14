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
    /* Runs `run` after `ms`; the handle goes back to `cancel`. Injected so a test holds the clock still. */
    timers?: { after(run: () => void, ms: number): unknown; cancel(handle: unknown): void };
}

const REAL_TIMERS = { after: (run: () => void, ms: number): unknown => setTimeout(run, ms), cancel: (handle: unknown): void => clearTimeout(handle as number) };

/*
 * The ticket the maps service accepts, held and renewed for every map on the page. A tile asks for
 * `header()` on each request, which is a read that also starts a renewal when one is due. While a map
 * listens, a timer asks again before the ticket ends and another after a failed ask; the ticket held
 * stays in use until it really ends, so a service that is down for a while does not blank a map that
 * had tiles.
 */
export class MapTickets {
    private readonly options: MapTicketsOptions;
    private readonly timers: NonNullable<MapTicketsOptions['timers']>;
    private ticket: MapsTicket | null = null;
    private failedAt: number | null = null;
    private snapshot: MapTicketState = { state: 'none' };
    private pending: Promise<void> | null = null;
    private readonly listeners = new Set<() => void>();
    private refresh: unknown = null;
    private expiry: unknown = null;
    private active = true;

    constructor(options: MapTicketsOptions) {
        this.options = options;
        this.timers = options.timers ?? REAL_TIMERS;
    }

    state(): MapTicketState {
        return this.snapshot;
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        this.arm();
        return () => {
            this.listeners.delete(listener);
            this.arm();
        };
    }

    /* Off while the setting is off or nobody is signed in: nothing is asked for, no timer runs and the ticket held is dropped. */
    setActive(active: boolean): void {
        if (this.active === active) {
            return;
        }
        this.active = active;
        if (!active) {
            this.ticket = null;
            this.failedAt = null;
        }
        this.publish();
    }

    /* Asks for a ticket when there is none, it is about to end or the last ask failed long enough ago. */
    ensure(): Promise<void> {
        if (this.pending !== null || !this.active) {
            return this.pending ?? Promise.resolve();
        }
        const now = this.options.now();
        const due = this.ticket === null || this.ticket.expiresAt - REFRESH_MARGIN_MS <= now;
        const waiting = this.failedAt !== null && now - this.failedAt < RETRY_AFTER_FAILURE_MS;
        if (!due || waiting) {
            return Promise.resolve();
        }
        this.pending = this.options
            .fetchTicket()
            .then(
                (ticket) => {
                    this.ticket = ticket;
                    this.failedAt = null;
                },
                () => {
                    this.failedAt = this.options.now();
                }
            )
            .finally(() => {
                this.pending = null;
                this.publish();
            });
        return this.pending;
    }

    /* The `authorization` header of a request to the maps service, or null when no ticket is held; a held ticket past its end counts as none. */
    header(): string | null {
        void this.ensure();
        const held = this.ticket;
        return held !== null && held.expiresAt > this.options.now() ? `Bearer ${held.ticket}` : null;
    }

    private derive(): MapTicketState {
        if (this.ticket !== null && this.ticket.expiresAt > this.options.now()) {
            return { state: 'ready', ticket: this.ticket };
        }
        return this.failedAt === null ? { state: 'none' } : { state: 'failed', since: this.failedAt };
    }

    private publish(): void {
        const next = this.derive();
        const same =
            next.state === this.snapshot.state && (next.state !== 'ready' || (this.snapshot.state === 'ready' && this.snapshot.ticket === next.ticket));
        if (!same) {
            this.snapshot = next;
            for (const listener of this.listeners) {
                listener();
            }
        }
        this.arm();
    }

    /* Timers run only while a map listens: one for the renewal or the retry, one for the moment the ticket ends. */
    private arm(): void {
        for (const handle of [this.refresh, this.expiry]) {
            if (handle !== null) {
                this.timers.cancel(handle);
            }
        }
        this.refresh = null;
        this.expiry = null;
        if (this.listeners.size === 0 || !this.active) {
            return;
        }
        const now = this.options.now();
        const ticket = this.ticket;
        const renewAt = ticket === null ? now : ticket.expiresAt - REFRESH_MARGIN_MS;
        const retryAt = this.failedAt === null ? 0 : this.failedAt + RETRY_AFTER_FAILURE_MS;
        this.refresh = this.timers.after(() => void this.ensure(), Math.max(0, Math.max(renewAt, retryAt) - now));
        if (ticket !== null && ticket.expiresAt > now) {
            this.expiry = this.timers.after(() => this.publish(), ticket.expiresAt - now);
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
