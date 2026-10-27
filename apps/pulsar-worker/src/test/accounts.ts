import type { Database } from 'bun:sqlite';
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import type { Env } from '../env.ts';
import { createSession } from '../sessions.ts';

export interface Pair {
    publicKey: string;
    privateKey: KeyObject;
}

export function newPair(): Pair {
    const keys = generateKeyPairSync('ed25519');
    return { publicKey: keys.publicKey.export({ format: 'jwk' }).x!, privateKey: keys.privateKey };
}

export function signWith(pair: Pair, message: string): string {
    return sign(null, Buffer.from(message), pair.privateKey).toString('base64url');
}

/* A GitHub account with one session on a laptop; answers its access token. */
export async function signIn(sqlite: Database, env: Env, accountId: string, now: number): Promise<string> {
    sqlite.query('INSERT INTO account (id, provider, subject, created_at) VALUES (?, ?, ?, ?)').run(accountId, 'github', accountId, now);
    const session = await createSession(env.DB, { id: accountId, provider: 'github', login: accountId, displayName: null }, 'laptop', newPair().publicKey);
    return session.accessToken;
}

export async function errorCode(response: Response): Promise<string> {
    return ((await response.json()) as { error: { code: string } }).error.code;
}
