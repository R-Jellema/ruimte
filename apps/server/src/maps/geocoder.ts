import { ADDRESS_BOOK_URL, MAPS_URL, MapsGeocodeResultSchema, MapsTicketSchema, mapsTicketMessage, type MapsTicket } from '@ruimte/pulsar';

/*
 * A point looked up once, or the reason there is none. `code` stays the same across versions and a
 * client words it; `reason` is the sentence for one that does not know the code.
 */
export type GeocodeReading = { state: 'found'; lat: number; lon: number; label: string } | { state: 'missing'; code: GeocodeMissingCode; reason: string };

export type GeocodeMissingCode = 'no-account' | 'not-found' | 'unreachable' | 'rate-limited' | 'maps-unconfigured' | 'unavailable';

export interface GeocoderOptions {
    fetch(url: string, init: RequestInit): Promise<Response>;
    /* The machine's ed25519 signature over a message, in base64url. */
    sign(message: string): string;
    machineId: string;
    /* Whether this machine is on an address book account; without one there is no ticket to ask for. */
    onAccount(): Promise<boolean>;
    now(): number;
    pulsarUrl?: string;
    mapsUrl?: string;
}

// A ticket is asked for again this long before it ends.
const TICKET_MARGIN_MS = 5 * 60_000;
// A refusal that is not a passing one holds the next lookups off this long, so a reply of fifty places asks once.
const BLOCK_MS: Readonly<Partial<Record<GeocodeMissingCode, number>>> = {
    'no-account': 60_000,
    'maps-unconfigured': 5 * 60_000,
    unavailable: 5 * 60_000,
    'rate-limited': 60_000,
    unreachable: 30_000
};

const REASONS: Readonly<Record<GeocodeMissingCode, string>> = {
    'no-account': 'This machine is on no account, so it has no map ticket to look an address up with.',
    'not-found': 'The map service found no place for this address.',
    unreachable: 'The map service could not be reached.',
    'rate-limited': 'The map service is limiting lookups; the address was not looked up.',
    'maps-unconfigured': 'The map service is not set up yet.',
    unavailable: 'The map service could not look this address up.'
};

function missing(code: GeocodeMissingCode): GeocodeReading {
    return { state: 'missing', code, reason: REASONS[code] };
}

/*
 * Looks up one address through Ruimte's map service as this machine: a ticket from the address book,
 * signed with the machine's key and kept until shortly before it ends, and a lookup with it. It holds no
 * account token. A refusal that will not pass in a moment is remembered for a while, since the caller
 * freezes what comes back and asks once per place.
 */
export class Geocoder {
    private readonly options: GeocoderOptions;
    private ticket: MapsTicket | null = null;
    private pending: Promise<MapsTicket | GeocodeReading> | null = null;
    private blocked: { code: GeocodeMissingCode; until: number } | null = null;

    constructor(options: GeocoderOptions) {
        this.options = options;
    }

    async geocode(query: string, language: string, signal?: AbortSignal): Promise<GeocodeReading> {
        if (signal?.aborted === true) {
            return missing('unreachable');
        }
        const held = this.blocked;
        if (held !== null && held.until > this.options.now()) {
            return missing(held.code);
        }
        if (!(await this.options.onAccount())) {
            return missing('no-account');
        }
        const ticket = await this.withinBudget(this.currentTicket(), signal);
        if (ticket === 'aborted') {
            return missing('unreachable');
        }
        if ('state' in ticket) {
            return ticket;
        }
        const reading = await this.lookup(ticket, query, language, signal);
        // A ticket the service no longer takes (the secret changed) is replaced once, never in a loop.
        if (reading === 'bad-ticket') {
            this.ticket = null;
            const fresh = await this.withinBudget(this.currentTicket(), signal);
            if (fresh === 'aborted') {
                return missing('unreachable');
            }
            if ('state' in fresh) {
                return fresh;
            }
            const again = await this.lookup(fresh, query, language, signal);
            return again === 'bad-ticket' ? this.refuse('unavailable') : again;
        }
        return reading;
    }

    /*
     * A ticket still being asked for is waited on only as long as the caller's budget lasts. The ask itself goes
     * on, shared with the next caller, so the ticket is there ahead of the next lookup.
     */
    private async withinBudget<Value>(work: Promise<Value>, signal: AbortSignal | undefined): Promise<Value | 'aborted'> {
        if (signal === undefined) {
            return work;
        }
        if (signal.aborted) {
            return 'aborted';
        }
        return new Promise((resolve, reject) => {
            const abandon = (): void => resolve('aborted');
            signal.addEventListener('abort', abandon, { once: true });
            work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abandon));
        });
    }

    private refuse(code: GeocodeMissingCode): GeocodeReading {
        const block = BLOCK_MS[code];
        if (block !== undefined) {
            this.blocked = { code, until: this.options.now() + block };
        }
        return missing(code);
    }

    private async currentTicket(): Promise<MapsTicket | GeocodeReading> {
        if (this.ticket !== null && this.ticket.expiresAt - TICKET_MARGIN_MS > this.options.now()) {
            return this.ticket;
        }
        this.pending ??= this.requestTicket().finally(() => {
            this.pending = null;
        });
        return this.pending;
    }

    private async requestTicket(): Promise<MapsTicket | GeocodeReading> {
        const issuedAt = this.options.now();
        let response: Response;
        try {
            response = await this.options.fetch(`${this.options.pulsarUrl ?? ADDRESS_BOOK_URL}/v1/maps/ticket`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    machineId: this.options.machineId,
                    issuedAt,
                    signature: this.options.sign(mapsTicketMessage(this.options.machineId, issuedAt))
                }),
                signal: AbortSignal.timeout(5_000)
            });
        } catch {
            return this.refuse('unreachable');
        }
        if (response.status === 404) {
            await response.body?.cancel();
            return this.refuse('no-account');
        }
        if (response.status === 429) {
            await response.body?.cancel();
            return this.refuse('rate-limited');
        }
        if (response.status === 503) {
            await response.body?.cancel();
            return this.refuse('maps-unconfigured');
        }
        if (!response.ok) {
            await response.body?.cancel();
            return this.refuse('unreachable');
        }
        const parsed = MapsTicketSchema.safeParse(await response.json().catch(() => null));
        if (!parsed.success) {
            return this.refuse('unreachable');
        }
        this.ticket = parsed.data;
        return parsed.data;
    }

    private async lookup(ticket: MapsTicket, query: string, language: string, signal: AbortSignal | undefined): Promise<GeocodeReading | 'bad-ticket'> {
        let response: Response;
        try {
            response = await this.options.fetch(`${this.options.mapsUrl ?? MAPS_URL}/v1/geocode`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', authorization: `Bearer ${ticket.ticket}` },
                body: JSON.stringify({ query, language }),
                signal: signal ?? AbortSignal.timeout(5_000)
            });
        } catch {
            // The caller's budget ran out, not the service: that says nothing about the next lookup.
            return signal?.aborted === true ? missing('unreachable') : this.refuse('unreachable');
        }
        if (response.status === 401) {
            await response.body?.cancel();
            return 'bad-ticket';
        }
        if (response.status === 429) {
            await response.body?.cancel();
            return this.refuse('rate-limited');
        }
        if (response.status === 503) {
            await response.body?.cancel();
            return this.refuse('maps-unconfigured');
        }
        if (response.status === 400 || response.status === 404) {
            await response.body?.cancel();
            return missing('not-found');
        }
        if (!response.ok) {
            await response.body?.cancel();
            return this.refuse('unavailable');
        }
        const parsed = MapsGeocodeResultSchema.safeParse(await response.json().catch(() => null));
        if (!parsed.success) {
            return signal?.aborted === true ? missing('unreachable') : this.refuse('unavailable');
        }
        const [first] = parsed.data.results;
        return first === undefined ? missing('not-found') : { state: 'found', lat: first.lat, lon: first.lon, label: first.label };
    }
}
