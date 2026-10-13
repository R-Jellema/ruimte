import { z } from 'zod';

const STRINGS = ['sample', '2026-10-13T08:00:00Z', '2026-10-13', 'a'];
const NUMBERS = [1, 0, 50, 0.5];

function firstThatParses(schema: z.ZodType, candidates: readonly unknown[]): unknown {
    return candidates.find((candidate) => schema.safeParse(candidate).success);
}

function build(schema: z.ZodType): unknown {
    if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
        const inner = build(schema.unwrap() as z.ZodType);
        return schema.safeParse(inner).success ? inner : schema instanceof z.ZodNullable ? null : undefined;
    }
    if (schema instanceof z.ZodDefault || schema instanceof z.ZodReadonly) {
        return build(schema.unwrap() as z.ZodType);
    }
    if (schema instanceof z.ZodPipe) {
        return build(schema.in as z.ZodType);
    }
    if (schema instanceof z.ZodLazy) {
        return build(schema.unwrap() as z.ZodType);
    }
    if (schema instanceof z.ZodObject) {
        const entries = Object.entries(schema.shape as Record<string, z.ZodType>).map(([key, field]) => [key, build(field)] as const);
        return Object.fromEntries(entries.filter(([, value]) => value !== undefined));
    }
    if (schema instanceof z.ZodArray) {
        return schema.safeParse([]).success ? [] : [build(schema.element as z.ZodType)];
    }
    if (schema instanceof z.ZodRecord) {
        return {};
    }
    if (schema instanceof z.ZodTuple) {
        return (schema.def.items as z.ZodType[]).map((item) => build(item));
    }
    if (schema instanceof z.ZodUnion) {
        for (const option of schema.options as z.ZodType[]) {
            const value = build(option);
            if (option.safeParse(value).success) {
                return value;
            }
        }
        return undefined;
    }
    if (schema instanceof z.ZodEnum) {
        return schema.options[0];
    }
    if (schema instanceof z.ZodLiteral) {
        return [...schema.values][0];
    }
    if (schema instanceof z.ZodBoolean) {
        return true;
    }
    if (schema instanceof z.ZodNull) {
        return null;
    }
    if (schema instanceof z.ZodNumber) {
        return firstThatParses(schema, NUMBERS);
    }
    return firstThatParses(schema, [...STRINGS, ...NUMBERS]);
}

/* The smallest value a schema takes, built from its shape: what a fake executor answers with. */
export function sampleOf<Schema extends z.ZodType>(schema: Schema): z.output<Schema> {
    const value = build(schema);
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
        throw new Error(`No sample for this schema: ${z.prettifyError(parsed.error)}`);
    }
    return parsed.data;
}
