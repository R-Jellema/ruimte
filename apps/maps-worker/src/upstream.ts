/*
 * What goes to TomTom and what comes back. The key is added here and removed from every body that echoes
 * it; a request carries nothing of the client (no address, cookies, referer or user agent).
 */

export const TOMTOM_ORIGIN = 'https://api.tomtom.com';

/* Only map display and its assets: this is not an open proxy to TomTom. */
const MAP_PATH = /^maps\/orbis\/(display|assets)\/[A-Za-z0-9._~%/-]{1,300}$/;

export function allowedMapPath(path: string): boolean {
    return MAP_PATH.test(path) && !path.includes('..') && !path.includes('//');
}

const PARAM_NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,40}$/;
const MAX_PARAM_VALUE = 120;

/* The query a client may pass on, sorted so two spellings of one request are one cache entry; `key` is never the client's to set. */
export function cleanQuery(params: URLSearchParams): [string, string][] {
    const kept: [string, string][] = [];
    for (const [name, value] of params) {
        if (PARAM_NAME.test(name) && name.toLowerCase() !== 'key' && value.length <= MAX_PARAM_VALUE) {
            kept.push([name, value]);
        }
    }
    return kept.toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

export function upstreamUrl(path: string, query: readonly (readonly [string, string])[], key: string): string {
    const params = new URLSearchParams(query as [string, string][]);
    params.set('key', key);
    return `${TOMTOM_ORIGIN}/${path}?${params.toString()}`;
}

/* A URL TomTom wrote into a body, as this service's own `/v1/map/` path, without the key. */
export function rewriteUrl(raw: string, origin: string): string {
    const [path = '', query = ''] = raw.split('?', 2);
    const kept = query.split('&').filter((param) => param !== '' && !/^key=/i.test(param));
    return `${origin}/v1/map/${path.slice(TOMTOM_ORIGIN.length + 1)}${kept.length > 0 ? `?${kept.join('&')}` : ''}`;
}

function rewriteValue(value: unknown, origin: string): unknown {
    if (typeof value === 'string') {
        return value.startsWith(`${TOMTOM_ORIGIN}/`) ? rewriteUrl(value, origin) : value;
    }
    if (Array.isArray(value)) {
        return value.map((entry) => rewriteValue(entry, origin));
    }
    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([name, entry]) => [name, rewriteValue(entry, origin)]));
    }
    return value;
}

/*
 * A text body (a style, a sprite index, a TileJSON) with every TomTom URL pointed at this service and
 * the key gone. Null when the key is still in it after that, which is a body nobody may see.
 */
export function sanitizedText(text: string, key: string, origin: string, json: boolean): string | null {
    let body = text;
    if (json) {
        try {
            body = JSON.stringify(rewriteValue(JSON.parse(text), origin));
        } catch {
            return null;
        }
    }
    body = body.replaceAll(/[?&]key=[^&"'\s\\]*/gi, '');
    return body.includes(key) ? null : body;
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
