import { describe, expect, test } from 'bun:test';
import {
    MAPS_TICKET_LIFETIME_MS,
    MapsTicketSchema,
    mapsSecretBytes,
    signMapsPath,
    verifyMapsPath,
    mapsTicketSubject,
    signMapsTicket,
    verifyMapsTicket
} from './index.ts';

// 32 bytes in base64url.
const secret = 'rpEgLz0VDkQ2M4v1o9s3bYt7JfHaCwXn6iUeNy8PqKg';
const otherSecret = 'Zk3mQ8vJx1LpT5aRn0cWy7DbHfUe2GsOi9NtV4Xr6Ml';
const now = 1_000_000;

describe('maps tickets', () => {
    test('a ticket the secret signed names its subject until it ends', async () => {
        const subject = await mapsTicketSubject(secret, 'account-1');
        const issued = await signMapsTicket(secret, subject, now + MAPS_TICKET_LIFETIME_MS);
        expect(MapsTicketSchema.safeParse(issued).success).toBe(true);
        expect(issued.expiresAt).toBe(now + MAPS_TICKET_LIFETIME_MS);
        expect(await verifyMapsTicket(secret, issued.ticket, now)).toEqual({ subject, expiresAt: issued.expiresAt });
        expect(await verifyMapsTicket(secret, issued.ticket, issued.expiresAt - 1)).not.toBeNull();
        expect(await verifyMapsTicket(secret, issued.ticket, issued.expiresAt)).toBeNull();
    });

    test('the subject is a keyed digest of the account: it hides the id and nobody without the secret can compute it', async () => {
        const subject = await mapsTicketSubject(secret, 'account-1');
        expect(subject).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(subject).not.toContain('account-1');
        expect(await mapsTicketSubject(secret, 'account-2')).not.toBe(subject);
        expect(await mapsTicketSubject(otherSecret, 'account-1')).not.toBe(subject);
        const plain = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('account:account-1')));
        expect(subject).not.toBe(Buffer.from(plain).toString('base64url'));
    });

    test('the mac is no subject: the same bytes signed for either purpose differ', async () => {
        const subject = await mapsTicketSubject(secret, 'account-1');
        const issued = await signMapsTicket(secret, subject, now + 60_000);
        expect(issued.ticket.split('.')[2]).not.toBe(subject);
    });

    test('another secret, another subject, a later expiry or a changed mac is refused', async () => {
        const subject = await mapsTicketSubject(secret, 'account-1');
        const { ticket, expiresAt } = await signMapsTicket(secret, subject, now + 60_000);
        const [, , mac] = ticket.split('.');
        expect(await verifyMapsTicket(otherSecret, ticket, now)).toBeNull();
        expect(await verifyMapsTicket(secret, `${await mapsTicketSubject(secret, 'account-2')}.${expiresAt}.${mac}`, now)).toBeNull();
        expect(await verifyMapsTicket(secret, `${subject}.${expiresAt + 1}.${mac}`, now)).toBeNull();
        expect(await verifyMapsTicket(secret, `${subject}.${expiresAt}.${'A'.repeat(43)}`, now)).toBeNull();
        expect(await verifyMapsTicket(secret, 'not-a-ticket', now)).toBeNull();
        expect(await verifyMapsTicket(secret, '', now)).toBeNull();
    });

    test('an expiry with a leading zero or past sixteen digits is no ticket', async () => {
        const subject = await mapsTicketSubject(secret, 'account-1');
        const mac = 'A'.repeat(43);
        expect(MapsTicketSchema.shape.ticket.safeParse(`${subject}.1234.${mac}`).success).toBe(true);
        for (const expiry of ['0', '0123', '12345678901234567', '-5', '1e9', '']) {
            expect(MapsTicketSchema.shape.ticket.safeParse(`${subject}.${expiry}.${mac}`).success).toBe(false);
        }
    });

    test('a secret under 32 bytes, or not base64url, is refused everywhere', async () => {
        expect(mapsSecretBytes(secret)?.byteLength).toBe(32);
        for (const weak of ['', 'short', 'a'.repeat(42), `${secret}!`, 'a'.repeat(45)]) {
            expect(mapsSecretBytes(weak)).toBeNull();
            await expect(mapsTicketSubject(weak, 'account-1')).rejects.toThrow('at least 32 bytes');
            await expect(signMapsTicket(weak, 'A'.repeat(43), now + 60_000)).rejects.toThrow('at least 32 bytes');
        }
        const { ticket } = await signMapsTicket(secret, await mapsTicketSubject(secret, 'account-1'), now + 60_000);
        expect(await verifyMapsTicket('short', ticket, now)).toBeNull();
    });

    test('a mark over a path holds for that text and that secret only, and is no ticket mac', async () => {
        const mark = await signMapsPath(secret, 'maps/orbis/display/vector/tile/{z}/{x}/{y}');
        expect(mark).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(await verifyMapsPath(secret, 'maps/orbis/display/vector/tile/{z}/{x}/{y}', mark)).toBe(true);
        expect(await verifyMapsPath(secret, 'maps/orbis/display/vector/tile/{z}/{x}/{y}/', mark)).toBe(false);
        expect(await verifyMapsPath(otherSecret, 'maps/orbis/display/vector/tile/{z}/{x}/{y}', mark)).toBe(false);
        expect(await verifyMapsPath('short', 'x', mark)).toBe(false);
        expect(await verifyMapsPath(secret, 'x', 'not a mark')).toBe(false);
        // The same text as a ticket's bytes gives another mark.
        expect(await signMapsPath(secret, 'a')).not.toBe(await signMapsPath(secret, 'b'));
        const ticket = await signMapsTicket(secret, await mapsTicketSubject(secret, 'account-1'), now + 60_000);
        expect(await verifyMapsPath(secret, ticket.ticket.split('.')[0]!, ticket.ticket.split('.')[2]!)).toBe(false);
    });
});
