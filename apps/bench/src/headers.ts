import { cspString, TELEMETRY_INGEST, withHeaders } from '@ruimte/csp';

/*
 * The client's policy, narrowed to what the comparison does: it reads the address book, reports its
 * errors and sessions to Observatory, draws its marks inline and frames nothing. Nothing may frame it or post out of it.
 */
export const CONTENT_SECURITY_POLICY = cspString({
    'base-uri': ["'none'"],
    'frame-src': ["'none'"],
    'frame-ancestors': ["'none'"],
    'form-action': ["'none'"],
    'script-src': ["'self'"],
    'img-src': ["'self'", 'data:'],
    'media-src': ["'none'"],
    'connect-src': ["'self'", 'https://pulsar.ruimte.app', TELEMETRY_INGEST],
    'worker-src': ["'none'"],
    'manifest-src': ["'self'"]
});

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
    'content-security-policy': CONTENT_SECURITY_POLICY,
    'strict-transport-security': 'max-age=63072000; includeSubDomains',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'cross-origin-opener-policy': 'same-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
};

export function withSecurityHeaders(response: Response, pathname: string): Response {
    return withHeaders(response, pathname, SECURITY_HEADERS);
}
