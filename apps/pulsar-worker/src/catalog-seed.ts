import { ROUTE_SCHEMAS, routesOf } from './catalog-schemas.ts';

interface SeedCatalog {
    defaultModel: string;
    profiles: Record<string, { options: unknown[]; contextWindowTokens: Record<string, number> }>;
    models: Array<{
        slug: string;
        name: string;
        profile: string;
        badge?: string;
        vendor?: string;
        aliases?: string[];
        legacy?: boolean;
        minCliVersion?: string;
        tools?: boolean;
    }>;
}

/*
 * Why this catalog may not seed its kind, or null when every route that serves the kind can hand it out. A kind D1
 * already holds is managed there, so only `force` writes over it.
 */
export function seedRefusalOf(kind: string, catalog: unknown, stored: boolean, force: boolean): string | null {
    const routes = routesOf(kind);

    if (routes.length === 0) {
        return `No route serves catalogs of kind "${kind}".`;
    }

    for (const route of routes) {
        const parsed = ROUTE_SCHEMAS[route].safeParse(catalog);

        if (!parsed.success) {
            const issues = parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`);

            return `The ${route} route cannot hand this catalog out: ${issues.join('; ')}`;
        }
    }

    if (stored && !force) {
        return `D1 already holds the ${kind} catalog and is where it changes now; pass --force to write over it.`;
    }

    return null;
}

function literal(value: string | number | boolean | null | undefined): string {
    if (value === null || value === undefined) {
        return 'NULL';
    }

    if (typeof value === 'boolean') {
        return value ? '1' : '0';
    }

    if (typeof value === 'number') {
        return String(value);
    }

    return `'${value.replaceAll("'", "''")}'`;
}

/* The statements that replace every row of the kind with the catalog; the triggers date it at the moment it lands. */
export function seedStatementsOf(kind: string, catalog: SeedCatalog): string[] {
    const statements = [
        `DELETE FROM model_catalog_models WHERE kind = ${literal(kind)}`,
        `DELETE FROM model_catalog_profiles WHERE kind = ${literal(kind)}`,
        `DELETE FROM model_catalogs WHERE kind = ${literal(kind)}`,
        `INSERT INTO model_catalogs (kind, default_model, updated_at) VALUES (${literal(kind)}, ${literal(catalog.defaultModel)}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`
    ];

    for (const [name, profile] of Object.entries(catalog.profiles)) {
        const values = [kind, name, JSON.stringify(profile.options), JSON.stringify(profile.contextWindowTokens)].map(literal).join(', ');
        statements.push(`INSERT INTO model_catalog_profiles (kind, name, options, context_window_tokens) VALUES (${values})`);
    }

    catalog.models.forEach((model, position) => {
        const values = [
            kind,
            model.slug,
            position,
            model.name,
            model.profile,
            model.badge,
            model.vendor,
            model.aliases === undefined ? null : JSON.stringify(model.aliases),
            model.legacy === true,
            model.minCliVersion,
            model.tools
        ]
            .map(literal)
            .join(', ');

        statements.push(
            `INSERT INTO model_catalog_models (kind, slug, position, name, profile, badge, vendor, aliases, legacy, min_cli_version, tools) VALUES (${values})`
        );
    });

    return statements;
}
