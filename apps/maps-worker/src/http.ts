import type { MapsErrorCode } from '@ruimte/pulsar';
import type { Env } from './env.ts';

const STATUS_OF: Record<MapsErrorCode, number> = {
    'maps-unconfigured': 503,
    'bad-ticket': 401,
    'rate-limited': 429,
    'not-found': 404,
    'bad-request': 400,
    upstream: 502,
    internal: 500
};

export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
    const outgoing = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    new Headers(headers).forEach((value, name) => outgoing.set(name, value));
    return new Response(JSON.stringify(body), { status, headers: outgoing });
}

export function failure(code: MapsErrorCode, message: string, headers: HeadersInit = {}): Response {
    return json({ error: { code, message } }, STATUS_OF[code], headers);
}

const LOOPBACK_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?$/;

/* `DESKTOP_APP_ORIGIN` in `@ruimte/contracts`, which this service does not depend on. */
const DESKTOP_APP_ORIGIN = 'app://ruimte';

/* The origin of a page that may read the answers: the desktop app, Vite on loopback and the listed web client. */
export function allowedOrigin(request: Request, env: Env): string | null {
    const origin = request.headers.get('origin');
    if (!origin) {
        return null;
    }
    if (origin === DESKTOP_APP_ORIGIN || LOOPBACK_ORIGIN.test(origin)) {
        return origin;
    }
    const extra = (env.ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
    return extra.includes(origin) ? origin : null;
}

/* The ticket rides in `authorization`, so a map request is not a simple request and every answer says who may read it. */
export function corsHeaders(origin: string | null): Record<string, string> {
    if (!origin) {
        return { vary: 'Origin' };
    }
    return {
        'access-control-allow-origin': origin,
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'authorization, content-type',
        'access-control-max-age': '600',
        vary: 'Origin'
    };
}
