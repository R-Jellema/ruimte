import { grantable, issueGrant, tailTemplate, type Grant, type GrantKind } from './grant.ts';
import { TOMTOM_ORIGIN } from './upstream.ts';

// What a query of an address the style names may hold, as TomTom wrote it: percent-encoding stays, nothing else is added.
const RAW_QUERY_PART = /^[A-Za-z0-9._~%*,:;@!$'()+/=-]*$/;

function decoded(text: string): string {
    try {
        return decodeURIComponent(text);
    } catch {
        return text;
    }
}

/*
 * A TomTom address a style names, split at the first `?` and each parameter at its first `=`, with the key left out and
 * every value as it was written, so a value that is percent-encoded is not encoded a second time. Null for any other
 * string, for a query with a character outside what TomTom writes, and for an address that holds the key anywhere.
 */
function parsed(raw: unknown, key: string): { path: string; query: [string, string][] } | null {
    if (typeof raw !== 'string' || !raw.startsWith(`${TOMTOM_ORIGIN}/`)) {
        return null;
    }
    const rest = raw.slice(TOMTOM_ORIGIN.length + 1);
    const mark = rest.indexOf('?');
    const path = mark === -1 ? rest : rest.slice(0, mark);
    const pairs: [string, string][] = [];
    for (const part of mark === -1 ? [] : rest.slice(mark + 1).split('&')) {
        const equals = part.indexOf('=');
        const name = equals === -1 ? part : part.slice(0, equals);
        const value = equals === -1 ? '' : part.slice(equals + 1);
        if (!RAW_QUERY_PART.test(name) || !RAW_QUERY_PART.test(value)) {
            return null;
        }
        if (name !== '' && name.toLowerCase() !== 'key') {
            pairs.push([name, value]);
        }
    }
    const holdsKey = [path, ...pairs.flat()].some((text) => text.includes(key) || decoded(text).includes(key));
    return holdsKey ? null : { path, query: pairs };
}

async function granted(secret: string, key: string, origin: string, kind: GrantKind, raw: unknown): Promise<string> {
    const address = parsed(raw, key);
    if (address === null || !grantable(kind, address.path)) {
        // An address of a shape this service does not serve is not passed on, so it can never be asked for.
        return '';
    }
    const grant: Grant = { kind, path: address.path, query: address.query };
    return `${origin}/v1/m/${await issueGrant(secret, grant)}/${tailTemplate(grant)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/* Blanks every other string that names TomTom, wherever it stands. */
function withoutTomTom(value: unknown): unknown {
    if (typeof value === 'string') {
        return value.includes(TOMTOM_ORIGIN) ? '' : value;
    }
    if (Array.isArray(value)) {
        return value.map(withoutTomTom);
    }
    if (isRecord(value)) {
        return Object.fromEntries(Object.entries(value).map(([name, entry]) => [name, withoutTomTom(entry)]));
    }
    return value;
}

/*
 * A style, a TileJSON or a sprite index with the addresses it names pointed at this service. Only the places
 * a style keeps an address in are rewritten (`sprite`, `glyphs`, `tiles`, a source's `url`), each as a grant;
 * a TomTom address anywhere else is blanked, so nothing the body names can be asked for any other way.
 */
export async function rewriteDocument(document: unknown, secret: string, key: string, origin: string): Promise<unknown> {
    if (!isRecord(document)) {
        return withoutTomTom(document);
    }
    const out: Record<string, unknown> = { ...document };
    const address = async (kind: GrantKind, value: unknown): Promise<unknown> =>
        typeof value === 'string' ? granted(secret, key, origin, kind, value) : withoutTomTom(value);
    const tiles = async (list: unknown): Promise<unknown> =>
        Array.isArray(list) ? Promise.all(list.map((entry) => granted(secret, key, origin, 'tile', entry))) : withoutTomTom(list);
    if ('sprite' in out) {
        out.sprite = await address('sprite', out.sprite);
    }
    if ('glyphs' in out) {
        out.glyphs = await address('glyphs', out.glyphs);
    }
    if ('tiles' in out) {
        out.tiles = await tiles(out.tiles);
    }
    if (isRecord(out.sources)) {
        const sources: Record<string, unknown> = {};
        for (const [id, source] of Object.entries(out.sources)) {
            if (!isRecord(source)) {
                sources[id] = withoutTomTom(source);
                continue;
            }
            const next: Record<string, unknown> = { ...source };
            if ('tiles' in next) {
                next.tiles = await tiles(next.tiles);
            }
            if ('url' in next) {
                next.url = await address('json', next.url);
            }
            blankRest(next, ['tiles', 'url']);
            sources[id] = next;
        }
        out.sources = sources;
        blankRest(out, ['sprite', 'glyphs', 'tiles', 'sources']);
    } else {
        blankRest(out, ['sprite', 'glyphs', 'tiles']);
    }
    return out;
}

/* Searches every field but the ones already rewritten for TomTom. */
function blankRest(record: Record<string, unknown>, rewritten: readonly string[]): void {
    for (const name of Object.keys(record)) {
        if (!rewritten.includes(name)) {
            record[name] = withoutTomTom(record[name]);
        }
    }
}
