import { fromBase64Url } from '@ruimte/pulsar';

/*
 * Cloudflare Access already stands in front of this worker. The worker checks the token Access adds
 * itself as well, so an Access application that is missing or too wide never opens the data.
 */

export interface AccessConfig {
    // `<team>.cloudflareaccess.com`, without a scheme.
    teamDomain: string;
    // The Application Audience (AUD) tag of the Access application.
    audience: string;
    email: string;
}

export interface AccessJwk {
    kid: string;
    kty: string;
    alg?: string;
    n?: string;
    e?: string;
}

// Access rotates its keys every six weeks and keeps the old one valid for a while, so an hour is fresh enough.
const KEYS_TTL_MS = 60 * 60_000;
// An unknown key id fetches the set again, but not more often than this, so a forged id cannot hammer the endpoint.
const KEYS_RETRY_MS = 60_000;
// Seconds of difference with the clock of Access that a token's times may have.
const LEEWAY_SECONDS = 60;

export class AccessKeys {
    private readonly fetchKeys: () => Promise<AccessJwk[]>;
    private readonly now: () => number;
    private keys: AccessJwk[] = [];
    private fetchedAt = -Infinity;

    constructor(fetchKeys: () => Promise<AccessJwk[]>, now: () => number) {
        this.fetchKeys = fetchKeys;
        this.now = now;
    }

    async find(kid: string): Promise<AccessJwk | null> {
        const age = this.now() - this.fetchedAt;
        const known = this.keys.find((key) => key.kid === kid);
        if ((known && age < KEYS_TTL_MS) || (!known && age < KEYS_RETRY_MS)) {
            return known ?? null;
        }
        try {
            this.keys = await this.fetchKeys();
            this.fetchedAt = this.now();
        } catch {
            return known ?? null;
        }
        return this.keys.find((key) => key.kid === kid) ?? null;
    }
}

/* The keys Access signs with for one team. */
export function accessCertsFetcher(teamDomain: string, request: typeof fetch = fetch): () => Promise<AccessJwk[]> {
    return async () => {
        const response = await request(`https://${teamDomain}/cdn-cgi/access/certs`, { redirect: 'manual' });
        if (!response.ok) {
            throw new Error(`Access certs answered ${response.status}`);
        }
        const body = (await response.json()) as { keys?: AccessJwk[] };
        return Array.isArray(body.keys) ? body.keys : [];
    };
}

function decodeJson(part: string): Record<string, unknown> | null {
    try {
        const value: unknown = JSON.parse(new TextDecoder().decode(fromBase64Url(part)));
        return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

/* The email of a valid Access token for this application and this one person, or null for any other. */
export async function verifyAccessToken(token: string, config: AccessConfig, keys: AccessKeys, now: number): Promise<string | null> {
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) {
        return null;
    }
    const [headerPart = '', payloadPart = '', signaturePart = ''] = parts;
    const header = decodeJson(headerPart);
    const payload = decodeJson(payloadPart);
    if (header === null || payload === null || header.alg !== 'RS256' || typeof header.kid !== 'string') {
        return null;
    }
    const jwk = await keys.find(header.kid);
    if (jwk === null || jwk.kty !== 'RSA') {
        return null;
    }
    let valid = false;
    try {
        const key = await crypto.subtle.importKey(
            'jwk',
            { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
            { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
            false,
            ['verify']
        );
        valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromBase64Url(signaturePart), new TextEncoder().encode(`${headerPart}.${payloadPart}`));
    } catch {
        return null;
    }
    if (!valid) {
        return null;
    }
    const seconds = now / 1000;
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audiences.includes(config.audience) || payload.iss !== `https://${config.teamDomain}`) {
        return null;
    }
    if (typeof payload.exp !== 'number' || payload.exp + LEEWAY_SECONDS < seconds) {
        return null;
    }
    if (typeof payload.nbf === 'number' && payload.nbf - LEEWAY_SECONDS > seconds) {
        return null;
    }
    if (typeof payload.email !== 'string' || payload.email.toLowerCase() !== config.email.toLowerCase()) {
        return null;
    }
    return payload.email;
}
