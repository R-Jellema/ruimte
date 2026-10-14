import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import {
    MAPS_TICKET_LIFETIME_MS,
    MAPS_TICKET_MACHINE_MAX_SKEW_MS,
    MapsTicketSchema,
    machineRegistrationMessage,
    mapsTicketMessage,
    mapsTicketSubject,
    verifyMapsTicket,
    type MapsTicket,
    type RegisterMachinePayload
} from '@ruimte/pulsar';
import type { Env } from './env.ts';
import { issueMapsTicket } from './maps-ticket.ts';
import { deleteMachine, registerMachine } from './machines.ts';
import { LIMITS } from './rate-limit.ts';
import { windowStartOf } from './rate-window.ts';
import { createSession } from './sessions.ts';
import { d1, migratedDatabase } from './test/sqlite-d1.ts';

interface Pair {
    publicKey: string;
    privateKey: KeyObject;
}

function newPair(): Pair {
    const keys = generateKeyPairSync('ed25519');
    return { publicKey: keys.publicKey.export({ format: 'jwk' }).x!, privateKey: keys.privateKey };
}

function signWith(pair: Pair, message: string): string {
    return sign(null, Buffer.from(message), pair.privateKey).toString('base64url');
}

// 32 bytes in base64url, as `openssl rand -base64 32` spells them once made url safe.
const SECRET = 'rpEgLz0VDkQ2M4v1o9s3bYt7JfHaCwXn6iUeNy8PqKg';
const OTHER_SECRET = 'Zk3mQ8vJx1LpT5aRn0cWy7DbHfUe2GsOi9NtV4Xr6Ml';

let sqlite: Database;
let env: Env;

async function signIn(accountId: string): Promise<string> {
    sqlite.query('INSERT INTO account (id, provider, subject, created_at) VALUES (?, ?, ?, ?)').run(accountId, 'github', accountId, Date.now());
    const session = await createSession(env.DB, { id: accountId, provider: 'github', login: accountId, displayName: null }, 'laptop', newPair().publicKey);
    return session.accessToken;
}

function post(body: unknown, token?: string, ip = '192.0.2.1'): Request {
    return new Request('https://pulsar.test/v1/maps/ticket', {
        method: 'POST',
        headers: { 'cf-connecting-ip': ip, ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) },
        body: JSON.stringify(body)
    });
}

async function listMachine(token: string, machine: Pair, machineId: string, accountId: string): Promise<void> {
    const issuedAt = Date.now();
    const payload: RegisterMachinePayload = {
        id: machineId,
        name: 'Studio',
        icon: null,
        publicKey: machine.publicKey,
        issuedAt,
        signature: signWith(machine, machineRegistrationMessage(accountId, machineId, machine.publicKey, 'Studio', issuedAt))
    };
    expect((await registerMachine(post(payload, token), env)).status).toBe(200);
}

function machineRequest(machine: Pair, machineId: string, issuedAt = Date.now()): unknown {
    return { machineId, issuedAt, signature: signWith(machine, mapsTicketMessage(machineId, issuedAt)) };
}

async function errorCode(response: Response): Promise<string> {
    return ((await response.json()) as { error: { code: string } }).error.code;
}

beforeEach(() => {
    sqlite = migratedDatabase();
    env = { DB: d1(sqlite), PUBLIC_ORIGIN: 'https://pulsar.test', MAP_TICKET_SECRET: SECRET };
});

describe('a ticket for a signed-in client', () => {
    test('is good for an hour, names a digest of the account, and the secret verifies it', async () => {
        const token = await signIn('owner');
        const before = Date.now();
        const response = await issueMapsTicket(post({}, token), env);
        expect(response.status).toBe(200);
        const issued = MapsTicketSchema.parse(await response.json()) satisfies MapsTicket;
        expect(issued.expiresAt).toBeGreaterThanOrEqual(before + MAPS_TICKET_LIFETIME_MS);
        expect(issued.expiresAt).toBeLessThanOrEqual(Date.now() + MAPS_TICKET_LIFETIME_MS);
        const subject = await mapsTicketSubject(SECRET, 'owner');
        expect(await verifyMapsTicket(SECRET, issued.ticket, Date.now())).toEqual({ subject, expiresAt: issued.expiresAt });
        expect(issued.ticket).not.toContain('owner');
        expect(await verifyMapsTicket(OTHER_SECRET, issued.ticket, Date.now())).toBeNull();
        expect(await verifyMapsTicket(SECRET, issued.ticket, issued.expiresAt)).toBeNull();
    });

    test('is refused for a token the address book does not know, and the machine route is not a way around it', async () => {
        const response = await issueMapsTicket(post({}, 'A'.repeat(43)), env);
        expect(response.status).toBe(401);
        expect(await errorCode(response)).toBe('unauthorized');
        const machine = newPair();
        const token = await signIn('owner');
        await listMachine(token, machine, 'studio', 'owner');
        expect(await errorCode(await issueMapsTicket(post(machineRequest(machine, 'studio'), 'A'.repeat(43)), env))).toBe('unauthorized');
    });

    test('two clients of one account get a ticket for the same subject', async () => {
        const first = await signIn('owner');
        const second = await createSession(env.DB, { id: 'owner', provider: 'github', login: 'owner', displayName: null }, 'phone', newPair().publicKey);
        const one = MapsTicketSchema.parse(await (await issueMapsTicket(post({}, first), env)).json());
        const two = MapsTicketSchema.parse(await (await issueMapsTicket(post({}, second.accessToken), env)).json());
        expect(one.ticket.split('.')[0]).toBe(two.ticket.split('.')[0]);
    });
});

describe('a ticket for a machine', () => {
    test('is issued to the key the account lists, for that account and no other', async () => {
        const token = await signIn('owner');
        await signIn('other');
        const machine = newPair();
        await listMachine(token, machine, 'studio', 'owner');
        const response = await issueMapsTicket(post(machineRequest(machine, 'studio')), env);
        expect(response.status).toBe(200);
        const issued = MapsTicketSchema.parse(await response.json());
        expect((await verifyMapsTicket(SECRET, issued.ticket, Date.now()))?.subject).toBe(await mapsTicketSubject(SECRET, 'owner'));
    });

    test('a namesake on another account cannot ask for the ticket of the first', async () => {
        const owner = await signIn('owner');
        const attacker = await signIn('attacker');
        const machine = newPair();
        const squatter = newPair();
        await listMachine(owner, machine, 'studio', 'owner');
        await listMachine(attacker, squatter, 'studio', 'attacker');
        const mine = MapsTicketSchema.parse(await (await issueMapsTicket(post(machineRequest(machine, 'studio')), env)).json());
        const theirs = MapsTicketSchema.parse(await (await issueMapsTicket(post(machineRequest(squatter, 'studio')), env)).json());
        expect((await verifyMapsTicket(SECRET, mine.ticket, Date.now()))?.subject).toBe(await mapsTicketSubject(SECRET, 'owner'));
        expect((await verifyMapsTicket(SECRET, theirs.ticket, Date.now()))?.subject).toBe(await mapsTicketSubject(SECRET, 'attacker'));
    });

    test('a signature by another key, for another machine or for another purpose is refused', async () => {
        const token = await signIn('owner');
        const machine = newPair();
        await listMachine(token, machine, 'studio', 'owner');
        await listMachine(token, newPair(), 'laptop', 'owner');
        const outsider = newPair();
        for (const body of [
            machineRequest(outsider, 'studio'),
            { ...(machineRequest(machine, 'studio') as object), machineId: 'laptop' },
            { machineId: 'studio', issuedAt: Date.now(), signature: signWith(machine, 'pulsar-session-refresh-v1\n[]') },
            machineRequest(machine, 'unknown')
        ]) {
            const response = await issueMapsTicket(post(body), env);
            expect(response.status).toBe(404);
            expect(await errorCode(response)).toBe('not-found');
        }
    });

    test('a request signed too long ago, or in the future, is refused as clock skew', async () => {
        const token = await signIn('owner');
        const machine = newPair();
        await listMachine(token, machine, 'studio', 'owner');
        for (const issuedAt of [Date.now() - MAPS_TICKET_MACHINE_MAX_SKEW_MS - 5_000, Date.now() + MAPS_TICKET_MACHINE_MAX_SKEW_MS + 5_000]) {
            expect(await errorCode(await issueMapsTicket(post(machineRequest(machine, 'studio', issuedAt)), env))).toBe('clock-skew');
        }
    });

    test('a machine taken off its account gets no ticket', async () => {
        const token = await signIn('owner');
        const machine = newPair();
        await listMachine(token, machine, 'studio', 'owner');
        expect((await issueMapsTicket(post(machineRequest(machine, 'studio')), env)).status).toBe(200);
        expect(
            (await deleteMachine(new Request('https://pulsar.test', { method: 'DELETE', headers: { authorization: `Bearer ${token}` } }), env, 'studio')).status
        ).toBe(204);
        const response = await issueMapsTicket(post(machineRequest(machine, 'studio')), env);
        expect(response.status).toBe(404);
        expect(await errorCode(response)).toBe('not-found');
    });

    test('a body that is no request is a bad request', async () => {
        expect(await errorCode(await issueMapsTicket(post({ machineId: 'studio' }), env))).toBe('bad-request');
    });
});

/* A counting window is a minute of the clock, so the limit tests stand still inside one. */
function holdClock(): void {
    const held = windowStartOf(Date.now()) + 1_000;
    spyOn(Date, 'now').mockReturnValue(held);
}

describe('without the secret or past the limits', () => {
    afterEach(() => {
        spyOn(Date, 'now').mockRestore();
    });

    test('the address book says it issues no tickets, and signs nothing', async () => {
        const token = await signIn('owner');
        const response = await issueMapsTicket(post({}, token), { ...env, MAP_TICKET_SECRET: undefined });
        expect(response.status).toBe(503);
        expect(await errorCode(response)).toBe('not-configured');
        expect((await issueMapsTicket(post({}, token), { ...env, MAP_TICKET_SECRET: '' })).status).toBe(503);
    });

    test('a secret that is not 32 bytes of base64url is as good as none', async () => {
        const token = await signIn('owner');
        for (const secret of ['short', 'a'.repeat(42), `${SECRET}!`, 'the shared maps secret of the maps service']) {
            const response = await issueMapsTicket(post({}, token), { ...env, MAP_TICKET_SECRET: secret });
            expect(response.status).toBe(503);
            expect(await errorCode(response)).toBe('not-configured');
        }
    });

    test('an account is limited per minute, and the answer says when to try again', async () => {
        const token = await signIn('owner');
        holdClock();
        for (let i = 0; i < LIMITS.mapsTicketAccount; i++) {
            expect((await issueMapsTicket(post({}, token, `192.0.2.${i + 10}`), env)).status).toBe(200);
        }
        const limited = await issueMapsTicket(post({}, token, '192.0.2.99'), env);
        expect(limited.status).toBe(429);
        expect(limited.headers.get('retry-after')).not.toBeNull();
    });

    test('an address is limited per minute even when its requests fail', async () => {
        holdClock();
        for (let i = 0; i < LIMITS.mapsTicketIp; i++) {
            expect((await issueMapsTicket(post({}, 'A'.repeat(43)), env)).status).toBe(401);
        }
        expect((await issueMapsTicket(post({}, 'A'.repeat(43)), env)).status).toBe(429);
    });
});
