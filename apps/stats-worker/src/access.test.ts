import { beforeAll, describe, expect, test } from 'bun:test';
import { toBase64Url } from '@ruimte/pulsar';
import { AccessKeys, verifyAccessToken, type AccessConfig, type AccessJwk } from './access.ts';

const CONFIG: AccessConfig = { teamDomain: 'ruimte.cloudflareaccess.com', audience: 'aud-tag', email: 'bas@example.com' };
const NOW = Date.parse('2026-10-16T12:00:00Z');
const SECONDS = NOW / 1000;

let signer: CryptoKey;
let otherSigner: CryptoKey;
let jwk: AccessJwk;

async function rsaPair(): Promise<CryptoKeyPair> {
    return crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, [
        'sign',
        'verify'
    ]);
}

function encode(value: unknown): string {
    return toBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

async function token(payload: Record<string, unknown> = {}, header: Record<string, unknown> = {}, key = signer): Promise<string> {
    const head = encode({ alg: 'RS256', kid: 'key-1', typ: 'JWT', ...header });
    const body = encode({
        aud: ['aud-tag'],
        iss: 'https://ruimte.cloudflareaccess.com',
        email: 'bas@example.com',
        iat: SECONDS - 10,
        exp: SECONDS + 600,
        ...payload
    });
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${body}`));
    return `${head}.${body}.${toBase64Url(signature)}`;
}

function keySet(clock: () => number = () => NOW): { keys: AccessKeys; fetches: () => number } {
    let fetches = 0;
    const keys = new AccessKeys(async () => {
        fetches += 1;
        return [jwk];
    }, clock);
    return { keys, fetches: () => fetches };
}

beforeAll(async () => {
    const pair = await rsaPair();
    signer = pair.privateKey;
    otherSigner = (await rsaPair()).privateKey;
    const exported = await crypto.subtle.exportKey('jwk', pair.publicKey);
    jwk = { kid: 'key-1', kty: 'RSA', alg: 'RS256', n: exported.n, e: exported.e };
});

describe('an Access token', () => {
    test('of the one person, for this application, signed by the team, lets in', async () => {
        expect(await verifyAccessToken(await token(), CONFIG, keySet().keys, NOW)).toBe('bas@example.com');
        expect(await verifyAccessToken(await token({ email: 'Bas@Example.com' }), CONFIG, keySet().keys, NOW)).toBe('Bas@Example.com');
    });

    test('of anyone else, another application or another team, does not', async () => {
        const { keys } = keySet();
        expect(await verifyAccessToken(await token({ email: 'someone@example.com' }), CONFIG, keys, NOW)).toBeNull();
        expect(await verifyAccessToken(await token({ email: undefined }), CONFIG, keys, NOW)).toBeNull();
        expect(await verifyAccessToken(await token({ aud: ['other-app'] }), CONFIG, keys, NOW)).toBeNull();
        expect(await verifyAccessToken(await token({ iss: 'https://evil.cloudflareaccess.com' }), CONFIG, keys, NOW)).toBeNull();
    });

    test('lets in only between its times, give or take a minute', async () => {
        const { keys } = keySet();
        expect(await verifyAccessToken(await token({ exp: SECONDS - 30 }), CONFIG, keys, NOW)).not.toBeNull();
        expect(await verifyAccessToken(await token({ exp: SECONDS - 61 }), CONFIG, keys, NOW)).toBeNull();
        expect(await verifyAccessToken(await token({ exp: undefined }), CONFIG, keys, NOW)).toBeNull();
        expect(await verifyAccessToken(await token({ nbf: SECONDS + 120 }), CONFIG, keys, NOW)).toBeNull();
    });

    test('signed by another key, changed after signing, or of another algorithm, does not', async () => {
        const { keys } = keySet();
        expect(await verifyAccessToken(await token({}, {}, otherSigner), CONFIG, keys, NOW)).toBeNull();
        const [head, , signature] = (await token()).split('.');
        const forged = `${head}.${encode({ aud: ['aud-tag'], iss: 'https://ruimte.cloudflareaccess.com', email: 'bas@example.com', exp: SECONDS + 600 })}x.${signature}`;
        expect(await verifyAccessToken(forged, CONFIG, keys, NOW)).toBeNull();
        expect(await verifyAccessToken(await token({}, { alg: 'none' }), CONFIG, keys, NOW)).toBeNull();
        expect(await verifyAccessToken(await token({}, { alg: 'HS256' }), CONFIG, keys, NOW)).toBeNull();
        expect(await verifyAccessToken('not.a.token', CONFIG, keys, NOW)).toBeNull();
        expect(await verifyAccessToken('', CONFIG, keys, NOW)).toBeNull();
    });

    test('with a key id the team does not have, does not', async () => {
        expect(await verifyAccessToken(await token({}, { kid: 'key-9' }), CONFIG, keySet().keys, NOW)).toBeNull();
    });
});

describe('the keys of the team', () => {
    test('are fetched once an hour, and again for an unknown id at most once a minute', async () => {
        let now = NOW;
        const { keys, fetches } = keySet(() => now);
        expect(await keys.find('key-1')).not.toBeNull();
        expect(await keys.find('key-1')).not.toBeNull();
        expect(fetches()).toBe(1);
        expect(await keys.find('key-9')).toBeNull();
        expect(fetches()).toBe(1);
        now += 61_000;
        expect(await keys.find('key-9')).toBeNull();
        expect(fetches()).toBe(2);
        now += 60 * 60_000;
        await keys.find('key-1');
        expect(fetches()).toBe(3);
    });

    test('that fail to load keep the ones already known', async () => {
        let now = NOW;
        let fail = false;
        const keys = new AccessKeys(
            async () => {
                if (fail) {
                    throw new Error('down');
                }
                return [jwk];
            },
            () => now
        );
        expect(await keys.find('key-1')).not.toBeNull();
        fail = true;
        now += 2 * 60 * 60_000;
        expect(await keys.find('key-1')).not.toBeNull();
    });
});
