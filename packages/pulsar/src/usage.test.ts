import { describe, expect, test } from 'bun:test';
import {
    AddressBookClient,
    USAGE_BLOBS,
    USAGE_COUNTERS,
    USAGE_DAY_MEASURES,
    USAGE_MAX_COUNT,
    USAGE_POINTS,
    USAGE_POINT_KINDS,
    UsageBatchSchema,
    isoWeekOf,
    usageBlob,
    usageColumn,
    usageDataPoints,
    usageDateProblem,
    type UsageDay
} from './index.ts';

const NOW = Date.parse('2026-10-16T09:30:00Z');

function day(overrides: Partial<UsageDay> = {}): UsageDay {
    return {
        date: '2026-10-15',
        version: '0.19.0',
        platform: 'darwin',
        arch: 'arm64',
        launcher: 'service',
        signedIn: true,
        firstThisWeek: true,
        firstThisMonth: false,
        cohortWeek: '2026-W40',
        counts: {},
        ...overrides
    };
}

function issuesOf(body: unknown): string[] {
    const parsed = UsageBatchSchema.safeParse(body);
    return parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join('.'));
}

describe('the usage layout', () => {
    test('every data point fits in what Analytics Engine stores', () => {
        for (const kind of USAGE_POINT_KINDS) {
            expect(USAGE_POINTS[kind].length).toBeLessThanOrEqual(20);
        }
        expect(USAGE_BLOBS.length).toBeLessThanOrEqual(20);
    });

    test('no field is stored twice, and the measures of a day lead its point', () => {
        const fields = USAGE_POINT_KINDS.flatMap((kind) => [...USAGE_POINTS[kind]]);
        expect(new Set(fields).size).toBe(fields.length);
        expect(USAGE_POINTS.day.slice(0, USAGE_DAY_MEASURES.length)).toEqual([...USAGE_DAY_MEASURES]);
        expect(USAGE_COUNTERS.length).toBe(fields.length - USAGE_DAY_MEASURES.length);
    });

    test('names the column of a field and a blob by their place', () => {
        expect(usageColumn('active')).toEqual({ point: 'day', column: 'double1' });
        expect(usageColumn('startupMs')).toEqual({ point: 'day', column: 'double4' });
        expect(usageColumn('viewsCanvas')).toEqual({ point: 'work', column: 'double1' });
        expect(usageColumn('turnsApple')).toEqual({ point: 'work', column: 'double19' });
        expect(usageColumn('verbsRead')).toEqual({ point: 'verbs', column: 'double1' });
        expect(usageBlob('point')).toBe('blob1');
        expect(usageBlob('cohortWeek')).toBe('blob8');
    });

    test('a day packs into the doubles the table names', () => {
        const points = usageDataPoints(day({ startupMs: 840, counts: { projectsOpened: 3, chatsCodex: 2, turnsCodex: 9 } }));
        expect(points.map((point) => point.blobs[0])).toEqual(['day', 'work']);
        const [dayPoint, workPoint] = points;
        expect(dayPoint!.indexes).toEqual(['2026-10-15']);
        expect(dayPoint!.blobs).toEqual(['day', '2026-10-15', '0.19.0', 'darwin', 'arm64', 'service', '1', '2026-W40']);
        expect(dayPoint!.doubles).toHaveLength(USAGE_POINTS.day.length);
        expect(dayPoint!.doubles.slice(0, 5)).toEqual([1, 1, 0, 840, 3]);
        expect(workPoint!.doubles[USAGE_POINTS.work.indexOf('chatsCodex')]).toBe(2);
        expect(workPoint!.doubles[USAGE_POINTS.work.indexOf('turnsCodex')]).toBe(9);
        expect(workPoint!.doubles.reduce((sum, value) => sum + value, 0)).toBe(11);
    });

    test('a day of nothing but presence is one write', () => {
        expect(usageDataPoints(day({ signedIn: false }))).toHaveLength(1);
        expect(usageDataPoints(day({ counts: { verbsAgent: 1 } })).map((point) => point.blobs[0])).toEqual(['day', 'verbs']);
    });
});

describe('a usage batch', () => {
    test('takes a full day and leaves out what is absent', () => {
        const counts = Object.fromEntries(USAGE_COUNTERS.map((counter) => [counter, 1]));
        expect(issuesOf({ days: [day({ counts, startupMs: 1200 })] })).toEqual([]);
        expect(issuesOf({ days: [day()] })).toEqual([]);
    });

    test('refuses keys it does not know, at every level', () => {
        expect(issuesOf({ days: [day()], installId: 'x' })).toEqual(['']);
        expect(issuesOf({ days: [{ ...day(), machine: 'm' }] })).toEqual(['days.0']);
        expect(issuesOf({ days: [day({ counts: { projectsOpened: 1, projectNames: 2 } as never })] })).toEqual(['days.0.counts']);
    });

    test('refuses counts that are negative, fractional or above the cap', () => {
        expect(issuesOf({ days: [day({ counts: { projectsOpened: -1 } })] })).toEqual(['days.0.counts.projectsOpened']);
        expect(issuesOf({ days: [day({ counts: { projectsOpened: 1.5 } })] })).toEqual(['days.0.counts.projectsOpened']);
        expect(issuesOf({ days: [day({ counts: { projectsOpened: USAGE_MAX_COUNT + 1 } })] })).toEqual(['days.0.counts.projectsOpened']);
        expect(issuesOf({ days: [day({ startupMs: 0 })] })).toEqual(['days.0.startupMs']);
    });

    test('holds one to seven distinct days', () => {
        const days = Array.from({ length: 8 }, (_, i) => day({ date: `2026-10-0${i + 1}` }));
        expect(issuesOf({ days: days.slice(0, 7) })).toEqual([]);
        expect(issuesOf({ days })).toEqual(['days']);
        expect(issuesOf({ days: [] })).toEqual(['days']);
        expect(issuesOf({ days: [day(), day()] })).toEqual(['days']);
    });

    test('refuses a date, version, week or platform of another shape', () => {
        expect(issuesOf({ days: [day({ date: '2026-02-30' })] })).toEqual(['days.0.date']);
        expect(issuesOf({ days: [day({ version: 'main' })] })).toEqual(['days.0.version']);
        expect(issuesOf({ days: [day({ cohortWeek: '2026-W54' })] })).toEqual(['days.0.cohortWeek']);
        expect(issuesOf({ days: [day({ cohortWeek: '2026-W43' })] })).toEqual(['days.0.cohortWeek']);
        expect(issuesOf({ days: [day({ platform: 'plan9' as never })] })).toEqual(['days.0.platform']);
        expect(issuesOf({ days: [day({ version: '0.0.0-test' })] })).toEqual([]);
    });
});

describe('the days the address book takes', () => {
    test('today and the eight days before it, nothing later or older', () => {
        expect(usageDateProblem('2026-10-16', NOW)).toBeNull();
        expect(usageDateProblem('2026-10-08', NOW)).toBeNull();
        expect(usageDateProblem('2026-10-07', NOW)).not.toBeNull();
        expect(usageDateProblem('2026-10-17', NOW)).not.toBeNull();
    });
});

describe('the ISO week', () => {
    test('starts on Monday and puts the first Thursday in week 1', () => {
        expect(isoWeekOf('2026-10-15')).toBe('2026-W42');
        expect(isoWeekOf('2026-10-12')).toBe('2026-W42');
        expect(isoWeekOf('2026-10-11')).toBe('2026-W41');
        expect(isoWeekOf('2027-01-01')).toBe('2026-W53');
        expect(isoWeekOf('2025-12-29')).toBe('2026-W01');
    });
});

describe('sending usage', () => {
    test('posts the batch without a token and takes an empty answer', async () => {
        const calls: { url: string; init: RequestInit }[] = [];
        const book = new AddressBookClient({
            baseUrl: 'https://pulsar.test',
            fetch: async (url, init) => {
                calls.push({ url, init });
                return new Response(null, { status: 204 });
            }
        });
        await book.sendUsage({ days: [day()] });
        expect(calls[0]!.url).toBe('https://pulsar.test/v1/usage');
        expect(calls[0]!.init.method).toBe('POST');
        expect(new Headers(calls[0]!.init.headers).has('authorization')).toBe(false);
        expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ days: [day()] });
    });
});
