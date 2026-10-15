import { signMapsPath, verifyMapsPath } from '@ruimte/pulsar';
import { z } from 'zod';
import { TOMTOM_ORIGIN } from './upstream.ts';

/*
 * What the maps service serves besides the style: only addresses the style itself named. Each such
 * address is written into the style as `/v1/m/<grant>/<tail>`, where the grant is the address as TomTom
 * wrote it (with its placeholders), under a mark only this service can make. A request carries the
 * grant and a tail that fills the placeholders; nothing else about the upstream path is the client's.
 */
export type GrantKind = 'tile' | 'glyphs' | 'sprite' | 'json';

const KINDS = ['tile', 'glyphs', 'sprite', 'json'] as const;

export interface Grant {
    kind: GrantKind;
    /* The path of the address without a leading slash, placeholders such as `{z}` left in. */
    path: string;
    /* The query the style wrote, without the key. */
    query: [string, string][];
}

const SEGMENT = /^(?:[A-Za-z0-9._~*@-]|\{(?:z|x|y|fontstack|range)\})+$/;

/* Only map display and its assets, in plain characters: a `%` in what the style names is not an address this service serves. */
export function validTemplatePath(path: string): boolean {
    const segments = path.split('/');
    return (
        path.length <= 300 &&
        /^maps\/orbis\/(map-display|assets)\//.test(path) &&
        segments.every((segment) => segment !== '.' && segment !== '..' && SEGMENT.test(segment))
    );
}

const GrantSchema = z.object({
    k: z.enum(KINDS),
    p: z.string().max(300),
    q: z.array(z.tuple([z.string().max(60), z.string().max(120)])).max(12)
});

const PLACEHOLDERS: Readonly<Record<string, string>> = {
    z: '\\d{1,2}',
    x: '\\d{1,8}',
    y: '\\d{1,8}',
    range: '\\d{1,6}-\\d{1,6}',
    // A font stack as a client writes it: names with spaces and commas, which stay percent-encoded.
    fontstack: '[A-Za-z0-9._~-]+(?:(?:%20|%2C|,)+[A-Za-z0-9._~-]+)*'
};

const REQUIRED: Readonly<Record<GrantKind, readonly string[]>> = { tile: ['z', 'x', 'y'], glyphs: ['fontstack', 'range'], sprite: [], json: [] };

function placeholdersOf(path: string): string[] {
    return [...path.matchAll(/\{([a-z]+)\}/g)].map((match) => match[1]!);
}

/* Whether the placeholders of an address are exactly those its kind fills, in the order a request fills them. */
export function grantable(kind: GrantKind, path: string): boolean {
    if (!validTemplatePath(path)) {
        return false;
    }
    const found = placeholdersOf(path);
    return found.length === REQUIRED[kind].length && found.every((name, index) => name === REQUIRED[kind][index]);
}

function segmentPattern(segment: string): RegExp {
    const source = segment
        .split(/(\{[a-z]+\})/)
        .map((part) => (part.startsWith('{') ? PLACEHOLDERS[part.slice(1, -1)]! : part.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')))
        .join('');
    return new RegExp(`^${source}$`);
}

/* The segments from the first placeholder on, which a request fills. */
export function tailOf(grant: Pick<Grant, 'path'>): string[] {
    const segments = grant.path.split('/');
    const first = segments.findIndex((segment) => segment.includes('{'));
    return first === -1 ? [] : segments.slice(first);
}

/* What a client is told to ask for: the placeholders again for a tile or a glyph range, a fixed name for the rest. */
export function tailTemplate(grant: Grant): string {
    return grant.kind === 'sprite' ? 'sprite' : grant.kind === 'json' ? 'tilejson' : tailOf(grant).join('/');
}

/* The upstream path a request's tail asks for, or null when the tail is not what the grant allows. */
export function pathFor(grant: Grant, tail: string): string | null {
    if (grant.kind === 'json') {
        return tail === 'tilejson' ? grant.path : null;
    }
    if (grant.kind === 'sprite') {
        const suffix = /^sprite((?:@[1-4]x)?\.(?:json|png))$/.exec(tail)?.[1];
        return suffix === undefined ? null : `${grant.path}${suffix}`;
    }
    const patterns = tailOf(grant).map(segmentPattern);
    const given = tail.split('/');
    if (given.length !== patterns.length || !patterns.every((pattern, index) => pattern.test(given[index]!))) {
        return null;
    }
    const segments = grant.path.split('/');
    return [...segments.slice(0, segments.length - patterns.length), ...given].join('/');
}

/*
 * The last word before a path leaves for TomTom: the URL parser must not change it, it must stay inside map
 * display and its assets, and any `%` is only a space or a comma of a font stack.
 */
export function upstreamPathAllowed(path: string): boolean {
    if (path.length > 400 || !/^maps\/orbis\/(map-display|assets)\/[A-Za-z0-9._~*@%,/-]+$/.test(path) || /%(?!20|2C)/i.test(path)) {
        return false;
    }
    const segments = path.split('/');
    if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
        return false;
    }
    try {
        return new URL(`${TOMTOM_ORIGIN}/${path}`).pathname === `/${path}`;
    } catch {
        return false;
    }
}

function base64UrlOf(text: string): string {
    return btoa(String.fromCharCode(...new TextEncoder().encode(text)))
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replace(/=+$/, '');
}

function textOfBase64Url(value: string): string {
    const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/'));
    return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

export async function issueGrant(secret: string, grant: Grant): Promise<string> {
    const payload = base64UrlOf(JSON.stringify({ k: grant.kind, p: grant.path, q: grant.query }));
    return `${payload}.${await signMapsPath(secret, payload)}`;
}

/* The grant a token carries, when this service made it and it still names a servable address. */
export async function readGrant(secret: string, token: string): Promise<Grant | null> {
    const [payload = '', mark = '', ...extra] = token.split('.');
    if (extra.length > 0 || !/^[A-Za-z0-9_-]{1,1200}$/.test(payload) || !(await verifyMapsPath(secret, payload, mark))) {
        return null;
    }
    try {
        const parsed = GrantSchema.safeParse(JSON.parse(textOfBase64Url(payload)));
        if (!parsed.success) {
            return null;
        }
        const grant: Grant = { kind: parsed.data.k, path: parsed.data.p, query: parsed.data.q };
        return grantable(grant.kind, grant.path) ? grant : null;
    } catch {
        return null;
    }
}
