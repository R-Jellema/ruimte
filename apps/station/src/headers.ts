import { cspString, TELEMETRY_INGEST, VISUAL_HOST_HEADERS, VISUAL_HOST_PATH, withHeaders } from '@ruimte/csp';

/*
 * The client's policy, tightened for a page on the public web. The client allows plain `http:` and
 * `ws:` because a machine can be at any address; nothing reaches the station over anything but TLS,
 * and nothing may frame it or post out of it.
 */
export const CONTENT_SECURITY_POLICY = cspString({
    'base-uri': ["'none'"],
    'frame-ancestors': ["'none'"],
    'form-action': ["'none'"],
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    'media-src': ["'self'", 'data:', 'blob:', 'https:'],
    'connect-src': ["'self'", 'blob:', 'https://pulsar.ruimte.app', 'wss:', 'https:', TELEMETRY_INGEST],
    'manifest-src': ["'self'"]
});

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
    'content-security-policy': CONTENT_SECURITY_POLICY,
    // Two years, the length the preload list asks for; `station` has no subdomains to break.
    'strict-transport-security': 'max-age=63072000; includeSubDomains',
    // A login returns here with a code in the query; no link out of the page should carry this address along.
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'cross-origin-opener-policy': 'same-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
};

/*
 * The sandbox host page of a visual, which the client's build writes at its path, under a policy of
 * its own: the page is framed by the client, so the denial of every frame stays with the other answers.
 */
const VISUAL_HOST_SECURITY_HEADERS: Readonly<Record<string, string>> = {
    ...Object.fromEntries(Object.entries(SECURITY_HEADERS).filter(([name]) => name !== 'x-frame-options')),
    ...VISUAL_HOST_HEADERS
};

/* Every answer with the headers above; the host page of a visual keeps the cache rule of its own. */
export function withSecurityHeaders(response: Response, pathname: string): Response {
    const visualHost = pathname === VISUAL_HOST_PATH;
    return withHeaders(response, pathname, visualHost ? VISUAL_HOST_SECURITY_HEADERS : SECURITY_HEADERS, !visualHost);
}
