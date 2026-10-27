import { PUSH_MAX_AGE_MS, type PushEnvelope } from '@ruimte/pulsar';
import type { Env } from './env.ts';
import { importP8, signEs256Jwt } from './jwt.ts';
import { countPush, pushOutcomeOf } from './metrics.ts';

type ApnsEnvironment = 'sandbox' | 'production';

export interface ApnsTarget {
    token: string;
    environment: ApnsEnvironment;
    startsActivity: boolean;
}

export interface ApnsResult {
    ok: boolean;
    status: number;
    reason?: string;
}

// APNs takes a token for an hour, and refuses a provider whose token changes more than once in 20 minutes.
const TOKEN_LIFETIME_MS = 50 * 60_000;

interface CachedToken {
    secret: string;
    keyId: string;
    teamId: string;
    // When the token in use was issued; until it is known, when this isolate asked for it.
    issuedAt: number;
    token: Promise<string>;
}

interface SharedToken {
    issued_at: number;
    token: string;
}

const tokens = new Map<ApnsEnvironment, CachedToken>();

function credentials(env: Env, environment: ApnsEnvironment) {
    return environment === 'sandbox'
        ? { secret: env.APNS_SANDBOX_KEY, keyId: env.APNS_SANDBOX_KEY_ID }
        : { secret: env.APNS_PRODUCTION_KEY, keyId: env.APNS_PRODUCTION_KEY_ID };
}

// Another isolate's clock may run a little ahead; its token is still the one to share.
const CLOCK_SKEW_MS = 60_000;

function fresh(issuedAt: number, now: number): boolean {
    return issuedAt - now < CLOCK_SKEW_MS && now - issuedAt < TOKEN_LIFETIME_MS;
}

function readShared(env: Env, environment: ApnsEnvironment, keyId: string, teamId: string): Promise<SharedToken | null> {
    return env.DB.prepare('SELECT issued_at, token FROM apns_provider_tokens WHERE environment = ?1 AND key_id = ?2 AND team_id = ?3')
        .bind(environment, keyId, teamId)
        .first<SharedToken>();
}

/*
 * The token every isolate of the Worker uses. Isolates come and go all day, so a token of each one's own
 * changed the provider's token far more often than APNs allows. A new one replaces the shared token only
 * once that has aged out or the key changed; an isolate that lost the race takes the winner's.
 */
async function sharedToken(env: Env, environment: ApnsEnvironment, secret: string, keyId: string, teamId: string, now: number): Promise<SharedToken> {
    // A push still goes out while the database does not answer, on a token of this isolate's own.
    const unshared = (e: unknown): null => {
        console.warn('APNs provider token is not shared', { error: e instanceof Error ? e.message : String(e) });

        return null;
    };

    const existing = await readShared(env, environment, keyId, teamId).catch(unshared);

    if (existing && fresh(existing.issued_at, now)) {
        return existing;
    }

    const key = await importP8(secret);
    const signed = { issued_at: now, token: await signEs256Jwt(key, { kid: keyId }, { iss: teamId, iat: Math.floor(now / 1000) }) };

    const stored = await env.DB.prepare(
        `INSERT INTO apns_provider_tokens (environment, key_id, team_id, issued_at, token) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (environment) DO UPDATE SET key_id = excluded.key_id, team_id = excluded.team_id, issued_at = excluded.issued_at, token = excluded.token
         WHERE apns_provider_tokens.key_id != excluded.key_id OR apns_provider_tokens.team_id != excluded.team_id OR apns_provider_tokens.issued_at <= ?6`
    )
        .bind(environment, keyId, teamId, now, signed.token, now - TOKEN_LIFETIME_MS)
        .run()
        .then(() => true)
        .catch(unshared);

    if (!stored) {
        return signed;
    }

    const winner = await readShared(env, environment, keyId, teamId).catch(unshared);

    return winner && fresh(winner.issued_at, now) ? winner : signed;
}

function providerToken(env: Env, environment: ApnsEnvironment, now: number): Promise<string> {
    const selected = credentials(env, environment);
    const secret = selected.secret!;
    const keyId = selected.keyId!;
    const teamId = env.APNS_TEAM_ID!;
    const cached = tokens.get(environment);

    if (cached && cached.secret === secret && cached.keyId === keyId && cached.teamId === teamId && fresh(cached.issuedAt, now)) {
        return cached.token;
    }

    const entry: CachedToken = { secret, keyId, teamId, issuedAt: now, token: Promise.resolve('') };
    const shared = sharedToken(env, environment, secret, keyId, teamId, now);

    entry.token = shared.then((resolved) => {
        entry.issuedAt = resolved.issued_at;

        return resolved.token;
    });

    tokens.set(environment, entry);

    void entry.token.catch(() => {
        if (tokens.get(environment) === entry) {
            tokens.delete(environment);
        }
    });

    return entry.token;
}

export function apnsConfigured(env: Env, environment: ApnsEnvironment): boolean {
    const { secret, keyId } = credentials(env, environment);
    return !!(secret && keyId && env.APNS_TEAM_ID && env.APNS_TOPIC);
}

export function apnsPayload(push: PushEnvelope, startsActivity: boolean, deliveredAt: number = push.issuedAt): object {
    if (push.pushType === 'background') {
        return { aps: { 'content-available': 1 }, ruimte: push };
    }
    if (push.pushType === 'alert') {
        return { aps: { alert: { title: 'Ruimte', body: 'An agent has an update for you.' }, 'mutable-content': 1, sound: 'default' }, ruimte: push };
    }
    const done = push.activity.phase === 'done';
    const quarterHourOn = Math.floor(deliveredAt / 1000) + 15 * 60;
    return {
        aps: {
            timestamp: Math.floor(push.issuedAt / 1000),
            event: done ? 'end' : startsActivity ? 'start' : 'update',
            'content-state': push.activity,
            'stale-date': quarterHourOn,
            'relevance-score': push.activity.phase === 'needs-you' ? 100 : 50,
            ...(done ? { 'dismissal-date': quarterHourOn } : {}),
            ...(startsActivity && !done
                ? {
                      'attributes-type': 'RuimteActivityAttributes',
                      'input-push-token': 1,
                      attributes: { machineId: push.machineId, collapseId: push.collapseId },
                      alert: { title: 'Ruimte', body: push.activity.title }
                  }
                : {})
        }
    };
}

export async function deliverApns(env: Env, target: ApnsTarget, push: PushEnvelope, now: number, send: typeof fetch = fetch): Promise<ApnsResult> {
    const body = JSON.stringify(apnsPayload(push, target.startsActivity, now));
    if (new TextEncoder().encode(body).byteLength > 4096) {
        countPush(push.pushType, 'too-large');
        return { ok: false, status: 413 };
    }
    if (!apnsConfigured(env, target.environment)) {
        countPush(push.pushType, 'not-configured');
        return { ok: false, status: 503 };
    }
    const host = target.environment === 'sandbox' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';
    const response = await send(`https://${host}/3/device/${target.token}`, {
        method: 'POST',
        headers: {
            authorization: `bearer ${await providerToken(env, target.environment, now)}`,
            'apns-topic': push.pushType === 'liveactivity' ? `${env.APNS_TOPIC}.push-type.liveactivity` : env.APNS_TOPIC!,
            'apns-push-type': push.pushType,
            'apns-priority': push.pushType === 'alert' || target.startsActivity ? '10' : '5',
            // A verified activity update may have waited for iOS to register its token.
            'apns-expiration': String(Math.floor((push.pushType === 'liveactivity' ? Math.max(push.expiresAt, now + PUSH_MAX_AGE_MS) : push.expiresAt) / 1000)),
            'apns-collapse-id': push.pushType === 'background' ? `read-${push.collapseId}` : push.collapseId,
            'content-type': 'application/json'
        },
        body
    });
    countPush(push.pushType, pushOutcomeOf(response.status, response.ok));
    if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { reason?: unknown } | null;
        const reason = typeof body?.reason === 'string' ? body.reason : undefined;
        // Apple's reasons are fixed words. Quoted, the longest (TooManyProviderTokenUpdates) reads as text to the scrubber and is blanked.
        const word = reason !== undefined && /^[A-Za-z]+$/.test(reason) ? reason : 'none';
        console.warn(`APNs delivery rejected: ${word}`, { pushType: push.pushType, status: response.status, startsActivity: target.startsActivity });
        return { ok: false, status: response.status, ...(reason ? { reason } : {}) };
    }
    await response.body?.cancel();
    return { ok: true, status: response.status };
}

export function invalidApnsToken(result: ApnsResult): boolean {
    return result.status === 410 || (result.status === 400 && (result.reason === 'BadDeviceToken' || result.reason === 'DeviceTokenNotForTopic'));
}
