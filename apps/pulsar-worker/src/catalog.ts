import claude from '@adecore/agents/providers/claude-models.json' with { type: 'json' };
import codex from '@adecore/agents/providers/codex-models.json' with { type: 'json' };
import { ROUTE_KINDS, ROUTE_SCHEMAS, type CatalogRoute } from './catalog-schemas.ts';
import { json } from './http.ts';

/*
 * The manifests the Worker was deployed with, for a kind D1 holds no readable catalog of and for a D1 that does not
 * answer. Once a kind is in D1, D1 is where it changes (`migrations/0019_model_catalogs.sql`).
 */
export const BUNDLED_CATALOGS: Readonly<Record<string, unknown>> = { claude, codex };

// Short enough that a fix to a catalog reaches every machine within the hour it asks.
const CACHE_CONTROL = 'public, max-age=300';

interface CatalogRow {
    kind: string;
    default_model: string;
    updated_at: string;
}

interface ProfileRow {
    kind: string;
    name: string;
    options: string;
    context_window_tokens: string;
}

interface ModelRow {
    kind: string;
    slug: string;
    name: string;
    profile: string;
    badge: string | null;
    vendor: string | null;
    aliases: string | null;
    legacy: number;
    min_cli_version: string | null;
    tools: number | null;
}

function modelOf(row: ModelRow): Record<string, unknown> {
    return {
        slug: row.slug,
        name: row.name,
        profile: row.profile,
        ...(row.badge === null ? {} : { badge: row.badge }),
        ...(row.vendor === null ? {} : { vendor: row.vendor }),
        ...(row.aliases === null ? {} : { aliases: JSON.parse(row.aliases) }),
        ...(row.legacy === 1 ? { legacy: true } : {}),
        ...(row.min_cli_version === null ? {} : { minCliVersion: row.min_cli_version }),
        ...(row.tools === null ? {} : { tools: row.tools === 1 })
    };
}

/* Every catalog in D1 in the shape a machine reads; a kind whose JSON columns do not parse is left out. */
export async function storedCatalogs(db: D1Database): Promise<Map<string, unknown>> {
    const stored = new Map<string, unknown>();
    let rows: [CatalogRow[], ProfileRow[], ModelRow[]];

    try {
        const [catalogs, profiles, models] = await db.batch([
            db.prepare('SELECT kind, default_model, updated_at FROM model_catalogs'),
            db.prepare('SELECT kind, name, options, context_window_tokens FROM model_catalog_profiles'),
            db.prepare('SELECT * FROM model_catalog_models ORDER BY kind, position, slug')
        ]);
        rows = [(catalogs?.results ?? []) as CatalogRow[], (profiles?.results ?? []) as ProfileRow[], (models?.results ?? []) as ModelRow[]];
    } catch (e) {
        console.warn('The model catalogs in D1 would not read; answering the bundled ones:', e);

        return stored;
    }

    const [catalogs, profiles, models] = rows;

    for (const catalog of catalogs) {
        try {
            stored.set(catalog.kind, {
                updatedAt: catalog.updated_at,
                defaultModel: catalog.default_model,
                profiles: Object.fromEntries(
                    profiles
                        .filter((profile) => profile.kind === catalog.kind)
                        .map((profile) => [
                            profile.name,
                            { options: JSON.parse(profile.options), contextWindowTokens: JSON.parse(profile.context_window_tokens) }
                        ])
                ),
                models: models.filter((model) => model.kind === catalog.kind).map(modelOf)
            });
        } catch {
            console.warn(`The ${catalog.kind} catalog in D1 holds JSON that does not parse; answering the bundled one`);
        }
    }

    return stored;
}

/* Per kind of the route the catalog in D1 when the route's frozen schema takes it, and the bundled manifest otherwise. */
export async function catalogsFor(db: D1Database, route: CatalogRoute): Promise<Record<string, unknown>> {
    const stored = await storedCatalogs(db);
    const catalogs: Record<string, unknown> = {};

    for (const kind of ROUTE_KINDS[route]) {
        const row = stored.get(kind);
        const readable = row !== undefined && ROUTE_SCHEMAS[route].safeParse(row).success;

        if (row !== undefined && !readable) {
            console.warn(`The ${kind} catalog in D1 does not pass the ${route} schema; answering the bundled one`);
        }

        const chosen = readable ? row : BUNDLED_CATALOGS[kind];

        if (chosen !== undefined) {
            catalogs[kind] = chosen;
        }
    }

    return catalogs;
}

export async function readCatalogs(db: D1Database, route: CatalogRoute): Promise<Response> {
    return json({ catalogs: await catalogsFor(db, route) }, 200, { 'cache-control': CACHE_CONTROL });
}
