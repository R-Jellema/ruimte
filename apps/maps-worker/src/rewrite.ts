import { grantable, issueGrant, tailTemplate, type Grant, type GrantKind } from './grant.ts';
import { TOMTOM_ORIGIN } from './upstream.ts';

/* A TomTom address a style names, split into its path and the query without the key; null for any other string. */
function parsed(raw: unknown): { path: string; query: [string, string][] } | null {
    if (typeof raw !== 'string' || !raw.startsWith(`${TOMTOM_ORIGIN}/`)) {
        return null;
    }
    const [path = '', query = ''] = raw.slice(TOMTOM_ORIGIN.length + 1).split('?', 2);
    const pairs: [string, string][] = [];
    for (const part of query.split('&')) {
        const [name = '', value = ''] = part.split('=', 2);
        if (name !== '' && name.toLowerCase() !== 'key') {
            pairs.push([name, value]);
        }
    }
    return { path, query: pairs };
}

async function granted(secret: string, origin: string, kind: GrantKind, raw: unknown): Promise<string> {
    const address = parsed(raw);
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
export async function rewriteDocument(document: unknown, secret: string, origin: string): Promise<unknown> {
    if (!isRecord(document)) {
        return withoutTomTom(document);
    }
    const out: Record<string, unknown> = { ...document };
    const tiles = async (list: unknown): Promise<unknown> =>
        Array.isArray(list) ? Promise.all(list.map((entry) => granted(secret, origin, 'tile', entry))) : withoutTomTom(list);
    if ('sprite' in out) {
        out.sprite = typeof out.sprite === 'string' ? await granted(secret, origin, 'sprite', out.sprite) : withoutTomTom(out.sprite);
    }
    if ('glyphs' in out) {
        out.glyphs = typeof out.glyphs === 'string' ? await granted(secret, origin, 'glyphs', out.glyphs) : withoutTomTom(out.glyphs);
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
                next.url = typeof next.url === 'string' ? await granted(secret, origin, 'json', next.url) : withoutTomTom(next.url);
            }
            for (const name of Object.keys(next)) {
                if (name !== 'tiles' && name !== 'url') {
                    next[name] = withoutTomTom(next[name]);
                }
            }
            sources[id] = next;
        }
        out.sources = sources;
    }
    // Everything else is searched for TomTom, with the places that were rewritten already clear of it.
    for (const name of Object.keys(out)) {
        if (name !== 'sprite' && name !== 'glyphs' && name !== 'tiles' && name !== 'sources') {
            out[name] = withoutTomTom(out[name]);
        }
    }
    return out;
}
