/*
 * What goes to TomTom and what comes back. The key is added here and kept out of every body that echoes it;
 * a request carries nothing of the client (no address, cookies, referer or user agent).
 */

export const TOMTOM_ORIGIN = 'https://api.tomtom.com';

/* The body types a map resource comes in. Text is only JSON, which is read; the rest is passed through as it is. */
const JSON_TYPE = /^application\/(json|[a-z.+-]*\+json)(;|$)/i;
const BINARY_TYPE = /^(application\/(x-protobuf|vnd\.mapbox-vector-tile|octet-stream)|image\/(png|jpeg|webp|gif))(;|$)/i;

export type BodyKind = 'json' | 'binary' | 'refused';

export function bodyKind(contentType: string | null): BodyKind {
    if (contentType === null) {
        return 'refused';
    }
    return JSON_TYPE.test(contentType) ? 'json' : BINARY_TYPE.test(contentType) ? 'binary' : 'refused';
}

export function upstreamUrl(path: string, query: readonly (readonly [string, string])[], key: string): string {
    // Written as the style wrote them: the values are percent-encoded already, and the key is a plain token.
    const parts = [...query.map(([name, value]) => `${name}=${value}`), `key=${encodeURIComponent(key)}`];
    return `${TOMTOM_ORIGIN}/${path}?${parts.join('&')}`;
}

/* How long TomTom lets a response be kept, in seconds; 0 for one it does not. */
export function cacheSeconds(headers: Headers): number {
    const control = (headers.get('cache-control') ?? '').toLowerCase();
    if (control === '' || /\b(no-store|no-cache|private)\b/.test(control)) {
        return 0;
    }
    const age = /\bs-maxage=(\d+)/.exec(control) ?? /\bmax-age=(\d+)/.exec(control);
    const seconds = age?.[1] === undefined ? 0 : Number(age[1]);
    const elapsed = Number(headers.get('age') ?? 0);
    return Number.isFinite(seconds) ? Math.max(0, seconds - (Number.isFinite(elapsed) ? elapsed : 0)) : 0;
}

export const UPSTREAM_HEADERS = { 'user-agent': 'ruimte-maps', accept: '*/*' } as const;
