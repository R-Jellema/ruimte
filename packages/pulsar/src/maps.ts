import { z } from 'zod';
import { fromBase64Url, toBase64Url } from './base64url.ts';
import { MachineIdSchema, SignatureSchema } from './keys.ts';
import { mapsTicketBytes } from './signing.ts';

// How long a ticket admits requests to the maps service; a client asks for a new one a little before.
export const MAPS_TICKET_LIFETIME_MS = 3_600_000;

// How far a machine's request may lie from the address book's clock, either way.
export const MAPS_TICKET_MACHINE_MAX_SKEW_MS = 120_000;

// The secret is 32 random bytes in base64url; anything shorter would make every ticket cheaper to forge.
export const MAPS_SECRET_MIN_BYTES = 32;

const SUBJECT_KEY_PURPOSE = 'pulsar-maps-ticket-subject-v1';

/*
 * `<subject>.<expiresAt>.<mac>`: the subject is a keyed digest of the account in base64url, the expiry is epoch
 * milliseconds and the mac is HMAC-SHA256 over `mapsTicketBytes`, so the maps service needs the secret and nothing else.
 */
export const MapsTicketSchema = z.object({
    ticket: z.string().regex(/^[A-Za-z0-9_-]{43}\.[1-9]\d{0,15}\.[A-Za-z0-9_-]{43}$/, 'Expected a maps ticket'),
    expiresAt: z.number().int().min(1)
});
export type MapsTicket = z.infer<typeof MapsTicketSchema>;

// A machine asks without an account token; the signature is by the key the account lists it with.
export const MachineMapsTicketPayloadSchema = z.object({
    machineId: MachineIdSchema,
    issuedAt: z.number().int().min(0),
    signature: SignatureSchema
});
export type MachineMapsTicketPayload = z.infer<typeof MachineMapsTicketPayloadSchema>;

/* The key bytes of a secret, or null when it is not base64url or holds fewer than `MAPS_SECRET_MIN_BYTES` bytes. */
export function mapsSecretBytes(secret: string): Uint8Array<ArrayBuffer> | null {
    if (!/^[A-Za-z0-9_-]+$/.test(secret)) {
        return null;
    }
    try {
        const bytes = fromBase64Url(secret);
        return bytes.byteLength >= MAPS_SECRET_MIN_BYTES ? bytes : null;
    } catch {
        return null;
    }
}

async function hmacKey(bytes: Uint8Array<ArrayBuffer>, usage: 'sign' | 'verify') {
    return crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

function secretOf(secret: string): Uint8Array<ArrayBuffer> {
    const bytes = mapsSecretBytes(secret);
    if (bytes === null) {
        throw new Error(`The maps secret must be base64url and at least ${MAPS_SECRET_MIN_BYTES} bytes`);
    }
    return bytes;
}

/*
 * The ticket subject of an account: a keyed digest, so nobody without the secret can compute the subject
 * of a known account id, and a key derived for this purpose alone, so it is no key of the mac.
 */
export async function mapsTicketSubject(secret: string, accountId: string): Promise<string> {
    const encoder = new TextEncoder();
    const derived = await crypto.subtle.sign('HMAC', await hmacKey(secretOf(secret), 'sign'), encoder.encode(SUBJECT_KEY_PURPOSE));
    const digest = await crypto.subtle.sign('HMAC', await hmacKey(new Uint8Array(derived), 'sign'), encoder.encode(`account:${accountId}`));
    return toBase64Url(digest);
}

export async function signMapsTicket(secret: string, subject: string, expiresAt: number): Promise<MapsTicket> {
    const mac = await crypto.subtle.sign('HMAC', await hmacKey(secretOf(secret), 'sign'), new TextEncoder().encode(mapsTicketBytes(subject, expiresAt)));
    return { ticket: `${subject}.${expiresAt}.${toBase64Url(mac)}`, expiresAt };
}

/* The subject of a ticket the secret signed and that has not ended, or null for any other. */
export async function verifyMapsTicket(secret: string, ticket: string, now: number): Promise<{ subject: string; expiresAt: number } | null> {
    const bytes = mapsSecretBytes(secret);
    if (bytes === null || !MapsTicketSchema.shape.ticket.safeParse(ticket).success) {
        return null;
    }
    const [subject = '', expiry = '', mac = ''] = ticket.split('.');
    const expiresAt = Number(expiry);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) {
        return null;
    }
    const valid = await crypto.subtle.verify(
        'HMAC',
        await hmacKey(bytes, 'verify'),
        fromBase64Url(mac),
        new TextEncoder().encode(mapsTicketBytes(subject, expiresAt))
    );
    return valid ? { subject, expiresAt } : null;
}
