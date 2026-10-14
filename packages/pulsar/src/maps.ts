import { z } from 'zod';
import { fromBase64Url, sha256, toBase64Url } from './base64url.ts';
import { MachineIdSchema, SignatureSchema } from './keys.ts';
import { mapsTicketBytes } from './signing.ts';

// How long a ticket admits requests to the maps service; a client asks for a new one a little before.
export const MAPS_TICKET_LIFETIME_MS = 3_600_000;

// How far a machine's request may lie from the address book's clock, either way.
export const MAPS_TICKET_MACHINE_MAX_SKEW_MS = 120_000;

/*
 * `<subject>.<expiresAt>.<mac>`: the subject is a digest of the account in base64url, the expiry is epoch
 * milliseconds and the mac is HMAC-SHA256 over `mapsTicketBytes`, so the maps service needs the secret and nothing else.
 */
export const MapsTicketSchema = z.object({
    ticket: z.string().regex(/^[A-Za-z0-9_-]{43}\.\d{1,16}\.[A-Za-z0-9_-]{43}$/, 'Expected a maps ticket'),
    expiresAt: z.number().int().min(0)
});
export type MapsTicket = z.infer<typeof MapsTicketSchema>;

// A machine asks without an account token; the signature is by the key the account lists it with.
export const MachineMapsTicketPayloadSchema = z.object({
    machineId: MachineIdSchema,
    issuedAt: z.number().int().min(0),
    signature: SignatureSchema
});
export type MachineMapsTicketPayload = z.infer<typeof MachineMapsTicketPayloadSchema>;

/* The ticket subject of an account. */
export function mapsTicketSubject(accountId: string): Promise<string> {
    return sha256(`account:${accountId}`);
}

function hmacKey(secret: string, usage: 'sign' | 'verify') {
    return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

export async function signMapsTicket(secret: string, subject: string, expiresAt: number): Promise<MapsTicket> {
    const mac = await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), new TextEncoder().encode(mapsTicketBytes(subject, expiresAt)));
    return { ticket: `${subject}.${expiresAt}.${toBase64Url(mac)}`, expiresAt };
}

/* The subject of a ticket the secret signed and that has not ended, or null for any other. */
export async function verifyMapsTicket(secret: string, ticket: string, now: number): Promise<{ subject: string; expiresAt: number } | null> {
    if (!MapsTicketSchema.shape.ticket.safeParse(ticket).success) {
        return null;
    }
    const [subject = '', expiry = '', mac = ''] = ticket.split('.');
    const expiresAt = Number(expiry);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) {
        return null;
    }
    const valid = await crypto.subtle.verify(
        'HMAC',
        await hmacKey(secret, 'verify'),
        fromBase64Url(mac),
        new TextEncoder().encode(mapsTicketBytes(subject, expiresAt))
    );
    return valid ? { subject, expiresAt } : null;
}
