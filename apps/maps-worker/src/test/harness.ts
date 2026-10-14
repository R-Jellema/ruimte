import { mapsTicketSubject, signMapsTicket } from '@ruimte/pulsar';
import type { Deps } from '../deps.ts';
import type { Env } from '../env.ts';
import { handle } from '../handler.ts';

// 32 bytes in base64url.
export const SECRET = 'rpEgLz0VDkQ2M4v1o9s3bYt7JfHaCwXn6iUeNy8PqKg';
export const KEY = 'tomtom-key-0123456789abcdef';
export const ORIGIN = 'https://maps.test';

export interface Upstream {
    url: string;
    headers: Headers;
    method: string;
}

export interface Harness {
    env: Env;
    now: number;
    upstream: Upstream[];
    /* What the cache holds, by the URL it was keyed under. */
    cached: Map<string, Response>;
    /* The subjects the rate limit counted. */
    limited: string[];
    /* Makes the rate limit refuse. */
    refuse: boolean;
    /* The answers of the fake upstream, one per call; the last one repeats. */
    answers: Array<(request: Upstream) => Response>;
    request(path: string, init?: RequestInit & { ticket?: string | null }): Promise<Response>;
    ticket(accountId?: string, lifetimeMs?: number): Promise<string>;
}

export function harness(overrides: Partial<Env> = {}): Harness {
    const state: Harness = {
        env: { PUBLIC_ORIGIN: ORIGIN, ALLOWED_ORIGINS: 'https://station.test', TOMTOM_API_KEY: KEY, MAP_TICKET_SECRET: SECRET, ...overrides },
        now: 1_800_000_000_000,
        upstream: [],
        cached: new Map(),
        limited: [],
        refuse: false,
        answers: [() => new Response('{}', { headers: { 'content-type': 'application/json' } })],
        async request(path, init = {}) {
            const { ticket, ...rest } = init;
            const token = ticket === undefined ? await state.ticket() : ticket;
            const headers = new Headers(rest.headers);
            if (token !== null) {
                headers.set('authorization', `Bearer ${token}`);
            }
            const pending: Promise<unknown>[] = [];
            const deps: Deps = {
                fetch: async (url, requestInit) => {
                    const call = { url, headers: new Headers(requestInit.headers), method: requestInit.method ?? 'GET' };
                    state.upstream.push(call);
                    const answer = state.answers[Math.min(state.upstream.length - 1, state.answers.length - 1)]!;
                    return answer(call);
                },
                cache: {
                    // The platform drops an entry once its max-age has passed.
                    match: async (request) => {
                        const entry = state.cached.get(request.url);
                        const age = Number(/max-age=(\d+)/.exec(entry?.headers.get('cache-control') ?? '')?.[1] ?? 0);
                        // Bun's and the platform's Response differ in type only.
                        return (entry && state.now - Number(entry.headers.get('x-stored-at')) < age * 1000 ? entry.clone() : undefined) as unknown as
                            | Response
                            | undefined;
                    },
                    put: async (request, response) => {
                        const stored = new Response(await response.arrayBuffer(), { headers: response.headers });
                        stored.headers.set('x-stored-at', String(state.now));
                        state.cached.set(request.url, stored);
                    }
                },
                now: () => state.now,
                defer: (work) => void pending.push(work)
            };
            const env: Env = {
                ...state.env,
                TICKET_LIMIT: {
                    limit: async ({ key }) => {
                        state.limited.push(key);
                        return { success: !state.refuse };
                    }
                }
            };
            const response = await handle(new Request(`${ORIGIN}${path}`, { ...rest, headers }), env, deps);
            await Promise.all(pending);
            return response;
        },
        async ticket(accountId = 'account-1', lifetimeMs = 3_600_000) {
            return (await signMapsTicket(SECRET, await mapsTicketSubject(SECRET, accountId), state.now + lifetimeMs)).ticket;
        }
    };
    return state;
}
