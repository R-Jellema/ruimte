import { z } from 'zod';

/*
 * The catalog schema of each route as the first release that read the route had it, so a catalog the oldest daemon
 * on a route cannot read is refused before it reaches D1. Never change one: a catalog that needs more goes on a new
 * route with a frozen schema of its own. Copied out of the contracts on purpose, since those move on.
 */

const SlugSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/);

const OptionSchema = z.discriminatedUnion('type', [
    z.object({
        id: z.string().min(1),
        label: z.string(),
        type: z.literal('select'),
        choices: z.array(z.object({ id: z.string().min(1), label: z.string(), description: z.string().optional() })).min(1),
        defaultChoice: z.string()
    }),
    z.object({
        id: z.string().min(1),
        label: z.string(),
        type: z.literal('boolean'),
        defaultValue: z.boolean(),
        description: z.string().optional()
    })
]);

const ProfileSchema = z.object({
    options: z.array(OptionSchema),
    contextWindowTokens: z.record(z.string(), z.number().int().positive())
});

const EntryV1Schema = z.object({
    slug: SlugSchema,
    name: z.string().min(1),
    badge: z.string().optional(),
    profile: z.string().min(1),
    aliases: z.array(z.string().min(1)).optional(),
    legacy: z.boolean().optional()
});

const EntryV2Schema = EntryV1Schema.extend({
    vendor: z.string().optional(),
    minCliVersion: z
        .string()
        .regex(/^\d+\.\d+(\.\d+)?$/)
        .optional(),
    tools: z.boolean().optional()
});

function catalogOf<Entry extends z.ZodType<{ slug: string; profile: string }>>(entry: Entry) {
    return z
        .object({
            updatedAt: z.iso.datetime(),
            defaultModel: SlugSchema,
            profiles: z.record(z.string(), ProfileSchema),
            models: z.array(entry).min(1)
        })
        .refine((data) => data.models.every((model) => data.profiles[model.profile] !== undefined))
        .refine((data) => data.models.some((model) => model.slug === data.defaultModel));
}

// `/v1/models/catalog`, as Ruimte 0.9.0 read it.
export const CATALOG_SCHEMA_V1 = catalogOf(EntryV1Schema);

// `/v2/models/catalog`, as `@adecore/agent-contracts` 0.40.5 has it.
export const CATALOG_SCHEMA_V2 = catalogOf(EntryV2Schema);

export type CatalogRoute = 'v1' | 'v2';

// The kinds each route answers. A daemon that reads v1 replaces an ACP agent's own models with a catalog, so v1 never carries one.
export const ROUTE_KINDS: Readonly<Record<CatalogRoute, readonly string[]>> = {
    v1: ['claude', 'codex'],
    v2: ['claude', 'codex', 'grok', 'copilot', 'antigravity']
};

export const ROUTE_SCHEMAS: Readonly<Record<CatalogRoute, z.ZodType>> = { v1: CATALOG_SCHEMA_V1, v2: CATALOG_SCHEMA_V2 };

/* The routes whose frozen schema a catalog of this kind has to pass, since each of them may hand it out. */
export function routesOf(kind: string): CatalogRoute[] {
    return (Object.keys(ROUTE_KINDS) as CatalogRoute[]).filter((route) => ROUTE_KINDS[route].includes(kind));
}
