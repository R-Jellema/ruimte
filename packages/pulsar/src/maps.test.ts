import { describe, expect, test } from 'bun:test';
import { MAPS_TICKET_LIFETIME_MS, MachineMapsTicketPayloadSchema, MapsTicketSchema, mapsTicketSubject, signMapsTicket, verifyMapsTicket } from './index.ts';

const secret = 'a-secret-of-the-maps-service';
const now = 1_000_000;

describe('maps tickets', () => {
    test('a ticket the secret signed names its subject until it ends', async () => {
        const subject = await mapsTicketSubject('account-1');
        const issued = await signMapsTicket(secret, subject, now + MAPS_TICKET_LIFETIME_MS);
        expect(MapsTicketSchema.safeParse(issued).success).toBe(true);
        expect(issued.expiresAt).toBe(now + MAPS_TICKET_LIFETIME_MS);
        expect(await verifyMapsTicket(secret, issued.ticket, now)).toEqual({ subject, expiresAt: issued.expiresAt });
        expect(await verifyMapsTicket(secret, issued.ticket, issued.expiresAt - 1)).not.toBeNull();
        expect(await verifyMapsTicket(secret, issued.ticket, issued.expiresAt)).toBeNull();
    });

    test('the subject is a digest of the account, not the account', async () => {
        const subject = await mapsTicketSubject('account-1');
        expect(subject).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(subject).not.toContain('account-1');
        expect(await mapsTicketSubject('account-2')).not.toBe(subject);
    });

    test('another secret, another subject, a later expiry or a changed mac is refused', async () => {
        const subject = await mapsTicketSubject('account-1');
        const { ticket, expiresAt } = await signMapsTicket(secret, subject, now + 60_000);
        const [, , mac] = ticket.split('.');
        expect(await verifyMapsTicket('another-secret', ticket, now)).toBeNull();
        expect(await verifyMapsTicket(secret, `${await mapsTicketSubject('account-2')}.${expiresAt}.${mac}`, now)).toBeNull();
        expect(await verifyMapsTicket(secret, `${subject}.${expiresAt + 1}.${mac}`, now)).toBeNull();
        expect(await verifyMapsTicket(secret, `${subject}.${expiresAt}.${'A'.repeat(43)}`, now)).toBeNull();
        expect(await verifyMapsTicket(secret, 'not-a-ticket', now)).toBeNull();
        expect(await verifyMapsTicket(secret, '', now)).toBeNull();
    });

    test('a machine request names a machine, a time and a signature', () => {
        const payload = { machineId: 'machine-1', issuedAt: 1, signature: 's'.repeat(86) };
        expect(MachineMapsTicketPayloadSchema.safeParse(payload).success).toBe(true);
        expect(MachineMapsTicketPayloadSchema.safeParse({ ...payload, signature: 's' }).success).toBe(false);
        expect(MachineMapsTicketPayloadSchema.safeParse({ machineId: '', issuedAt: 1, signature: payload.signature }).success).toBe(false);
    });
});
