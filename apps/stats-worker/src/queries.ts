import {
    USAGE_DAY_MEASURES,
    USAGE_POINTS,
    USAGE_POINT_KINDS,
    USAGE_TEST_VERSION_PREFIX,
    usageBlob,
    usageColumn,
    type UsageBlob,
    type UsageField,
    type UsagePointKind
} from '@ruimte/pulsar';

export const DATASET = 'ruimte_usage';

// The dimensions a day's presence is broken down by; each is one query and its rows carry the dimension's name.
export const SEGMENTS = ['version', 'platform', 'arch', 'launcher', 'signedIn', 'cohortWeek'] as const satisfies readonly UsageBlob[];
export type Segment = (typeof SEGMENTS)[number];

// What a day's `day` point says about presence, summed per segment value.
export const PRESENCE = ['active', 'firstThisWeek', 'firstThisMonth'] as const satisfies readonly UsageField[];

export const STARTUP_QUANTILES = { startupP50: 0.5, startupP90: 0.9 } as const;
export type StartupMetric = keyof typeof STARTUP_QUANTILES;

/*
 * One total of one UTC day: across every machine when `dimension` is empty, else for one value of it.
 * The rows the nightly rollup stores in D1 and the dashboard reads from either place.
 */
export interface UsageRow {
    date: string;
    dimension: Segment | '';
    value: string;
    metric: UsageField | StartupMetric;
    total: number;
}

export type UsageQuery =
    | { kind: 'totals'; point: UsagePointKind; sql: string }
    | { kind: 'segment'; segment: Segment; sql: string }
    | { kind: 'startup'; sql: string };

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MEASURES: ReadonlySet<string> = new Set(USAGE_DAY_MEASURES);

/* The fields of a point that add up across machines: every count, and presence on `day`. */
export function summedFields(point: UsagePointKind): UsageField[] {
    return USAGE_POINTS[point].filter((field) => !MEASURES.has(field) || (PRESENCE as readonly string[]).includes(field));
}

function sum(field: UsageField): string {
    return `SUM(_sample_interval * ${usageColumn(field).column}) AS ${field}`;
}

// Sampled rows stand for `_sample_interval` rows each, so every aggregate weighs by it.
function where(point: UsagePointKind, from: string, to: string): string {
    if (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(to)) {
        throw new Error('Expected dates as YYYY-MM-DD');
    }
    const date = usageBlob('date');
    return [
        `${usageBlob('point')} = '${point}'`,
        `${date} >= '${from}'`,
        `${date} <= '${to}'`,
        `${usageBlob('version')} NOT LIKE '${USAGE_TEST_VERSION_PREFIX}%'`,
        // A day is written on or after its date, so this only spares the scan.
        `timestamp >= toDateTime('${from} 00:00:00')`
    ].join(' AND ');
}

/* Every query that together make the rows of the days from `from` to `to`, inclusive. */
export function usageQueries(from: string, to: string): UsageQuery[] {
    const date = usageBlob('date');
    const totals = USAGE_POINT_KINDS.map((point): UsageQuery => ({
        kind: 'totals',
        point,
        sql: `SELECT ${date} AS date, ${summedFields(point).map(sum).join(', ')} FROM ${DATASET} WHERE ${where(point, from, to)} GROUP BY date FORMAT JSON`
    }));
    const segments = SEGMENTS.map((segment): UsageQuery => ({
        kind: 'segment',
        segment,
        sql: `SELECT ${date} AS date, ${usageBlob(segment)} AS value, ${PRESENCE.map(sum).join(', ')} FROM ${DATASET} WHERE ${where('day', from, to)} GROUP BY date, value FORMAT JSON`
    }));
    const startup = usageColumn('startupMs').column;
    const quantiles = Object.entries(STARTUP_QUANTILES)
        .map(([metric, quantile]) => `quantileExactWeighted(${quantile})(${startup}, _sample_interval) AS ${metric}`)
        .join(', ');
    const startupQuery: UsageQuery = {
        kind: 'startup',
        sql: `SELECT ${date} AS date, ${quantiles} FROM ${DATASET} WHERE ${where('day', from, to)} AND ${startup} > 0 GROUP BY date FORMAT JSON`
    };
    return [...totals, ...segments, startupQuery];
}

function numberOf(value: unknown): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

/* The rows a query's answer holds; a total of zero is left out, since a missing row reads as zero. */
export function rowsOf(query: UsageQuery, data: readonly Record<string, unknown>[]): UsageRow[] {
    const rows: UsageRow[] = [];
    for (const record of data) {
        const date = String(record.date ?? '');
        if (!DATE_PATTERN.test(date)) {
            continue;
        }
        const dimension = query.kind === 'segment' ? query.segment : '';
        const value = query.kind === 'segment' ? String(record.value ?? '') : '';
        const metrics: readonly (UsageField | StartupMetric)[] =
            query.kind === 'totals' ? summedFields(query.point) : query.kind === 'segment' ? PRESENCE : (Object.keys(STARTUP_QUANTILES) as StartupMetric[]);
        for (const metric of metrics) {
            const total = numberOf(record[metric]);
            if (total !== 0) {
                rows.push({ date, dimension, value, metric, total });
            }
        }
    }
    return rows;
}

const DAY_MS = 86_400_000;

export function dateOf(time: number): string {
    return new Date(time).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
    return dateOf(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS);
}

/*
 * The days still open at `now`: a machine sends a day up to eight days after it, so the ninth day back is the
 * last one that can still change, and yesterday the first that can hold anything.
 */
export function openDays(now: number): { from: string; to: string } {
    const today = dateOf(now);
    return { from: addDays(today, -9), to: addDays(today, -1) };
}
