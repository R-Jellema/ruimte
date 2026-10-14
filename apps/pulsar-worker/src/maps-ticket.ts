import {
    MAPS_TICKET_LIFETIME_MS,
    MAPS_TICKET_MACHINE_MAX_SKEW_MS,
    MachineMapsTicketPayloadSchema,
    mapsTicketMessage,
    mapsTicketSubject,
    signMapsTicket
} from '@ruimte/pulsar';
import { verifySignature } from '@ruimte/pulsar/verify-web';
import type { Env } from './env.ts';
import { clientIp, failure, json, readBody } from './http.ts';
import { LIMITS, overAnyLimit } from './rate-limit.ts';
import { authenticate } from './sessions.ts';

/*
 * The account of the machine that signed this request: the one listing the machine id under the key
 * that verifies. An id is no secret and another account may list it under a key of its own, so the
 * signature decides, not the id.
 */
async function accountOfMachine(db: D1Database, machineId: string, issuedAt: number, signature: string): Promise<string | null> {
    const { results } = await db
        .prepare('SELECT account_id, public_key FROM machine WHERE id = ?1')
        .bind(machineId)
        .all<{ account_id: string; public_key: string }>();
    const message = mapsTicketMessage(machineId, issuedAt);
    for (const row of results) {
        if (await verifySignature(row.public_key, message, signature)) {
            return row.account_id;
        }
    }
    return null;
}

/*
 * `POST /v1/maps/ticket`. A signed-in client sends its bearer token; a machine with no token signs the
 * request with its own key. Either gets a ticket for its account that the maps service checks with the
 * shared secret alone, so a tile request never reaches this database.
 */
export async function issueMapsTicket(request: Request, env: Env): Promise<Response> {
    const ip = clientIp(request);
    const limited = await overAnyLimit(env.DB, [[`ip:${ip}:maps`, LIMITS.mapsTicketIp]]);
    if (limited) {
        return limited;
    }
    if (!env.MAP_TICKET_SECRET) {
        return failure('not-configured', 'The address book issues no map tickets yet');
    }
    let accountId: string;
    if (request.headers.has('authorization')) {
        const session = await authenticate(request, env.DB);
        if (!session) {
            return failure('unauthorized', 'Sign in again');
        }
        accountId = session.account.id;
    } else {
        const body = await readBody(request, MachineMapsTicketPayloadSchema);
        if ('response' in body) {
            return body.response;
        }
        const { machineId, issuedAt, signature } = body.value;
        if (Math.abs(Date.now() - issuedAt) > MAPS_TICKET_MACHINE_MAX_SKEW_MS) {
            return failure('clock-skew', 'The request was signed too long ago, or the machine clock is off');
        }
        // A machine taken off its account has no row left, so it answers the same as one that never joined.
        const owner = await accountOfMachine(env.DB, machineId, issuedAt, signature);
        if (owner === null) {
            return failure('not-found', 'No account lists this machine under the key that signed the request');
        }
        accountId = owner;
    }
    const perAccount = await overAnyLimit(env.DB, [[`account:${accountId}:maps`, LIMITS.mapsTicketAccount]]);
    if (perAccount) {
        return perAccount;
    }
    return json(await signMapsTicket(env.MAP_TICKET_SECRET, await mapsTicketSubject(accountId), Date.now() + MAPS_TICKET_LIFETIME_MS));
}
