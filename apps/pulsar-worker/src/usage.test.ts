import { beforeEach, describe, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import type { UsageDataPoint, UsageDay } from '@ruimte/pulsar';
import { d1, migratedDatabase } from './test/sqlite-d1.ts';
import { USAGE_BATCHES_PER_IP_PER_DAY, acceptUsage, rateLimitCleanup, type UsageDeps } from './usage.ts';

const NOW = Date.parse('2026-10-16T09:30:00Z');
const IP = '192.0.2.7';

let sqlite: Database;
let written: UsageDataPoint[];
let burstAllows: boolean;
let deps: UsageDeps;

function day(overrides: Partial<UsageDay> = {}): UsageDay {
    return {
        date: '2026-10-15',
        version: '0.19.0',
        platform: 'linux',
        arch: 'x64',
        launcher: 'standalone',
        signedIn: false,
        firstThisWeek: false,
        firstThisMonth: false,
        cohortWeek: '2026-W41',
        counts: { terminalsStarted: 4, chatsClaude: 1 },
        ...overrides
    };
}

function post(body: unknown, ip = IP): Request {
    return new Request('https://pulsar.test/v1/usage', { method: 'POST', headers: { 'cf-connecting-ip': ip }, body: JSON.stringify(body) });
}

async function errorOf(response: Response): Promise<{ code: string; message: string }> {
    return ((await response.json()) as { error: { code: string; message: string } }).error;
}

beforeEach(() => {
    sqlite = migratedDatabase();
    written = [];
    burstAllows = true;
    deps = {
        db: d1(sqlite),
        dataset: { writeDataPoint: (point) => written.push(point) },
        burst: { limit: async () => ({ success: burstAllows }) },
        now: () => NOW
    };
});

describe('a usage batch', () => {
    test('is written as the data points of its days and answered without a body', async () => {
        const response = await acceptUsage(post({ days: [day(), day({ date: '2026-10-14', counts: {} })] }), deps);
        expect(response.status).toBe(204);
        expect(written.map((point) => `${point.blobs[1]} ${point.blobs[0]}`)).toEqual(['2026-10-15 day', '2026-10-15 work', '2026-10-14 day']);
    });

    test('is refused whole when one day is too old or still to come', async () => {
        const old = await acceptUsage(post({ days: [day(), day({ date: '2026-10-07' })] }), deps);
        expect(old.status).toBe(400);
        expect((await errorOf(old)).message).toStartWith('days.1.date');
        const future = await acceptUsage(post({ days: [day({ date: '2026-10-17' })] }), deps);
        expect(future.status).toBe(400);
        expect(written).toEqual([]);
    });

    test('is refused when it carries anything the schema does not name', async () => {
        const response = await acceptUsage(post({ days: [day()], machineId: 'abc' }), deps);
        expect(response.status).toBe(400);
        expect(written).toEqual([]);
    });

    test('is refused while the per-minute limit holds, before it is read', async () => {
        burstAllows = false;
        const response = await acceptUsage(post({ days: [day()] }), deps);
        expect(response.status).toBe(429);
        expect(written).toEqual([]);
    });

    test('is refused past the daily cap of an address, and another address still sends', async () => {
        for (let i = 0; i < USAGE_BATCHES_PER_IP_PER_DAY; i++) {
            expect((await acceptUsage(post({ days: [day()] }), deps)).status).toBe(204);
        }
        expect((await acceptUsage(post({ days: [day()] }), deps)).status).toBe(429);
        expect((await acceptUsage(post({ days: [day()] }, '198.51.100.3'), deps)).status).toBe(204);
    });

    test('never stores the address itself', async () => {
        await acceptUsage(post({ days: [day()] }), deps);
        const buckets = sqlite.query('SELECT bucket FROM rate_limit').all() as { bucket: string }[];
        expect(buckets).toHaveLength(1);
        expect(buckets[0]!.bucket).toStartWith('usage:');
        expect(buckets[0]!.bucket).not.toContain(IP);
    });

    test('is not taken while no dataset is bound', async () => {
        const response = await acceptUsage(post({ days: [day()] }), { ...deps, dataset: undefined });
        expect(response.status).toBe(503);
    });
});

describe('the cleanup of rate limit buckets', () => {
    test('keeps a usage bucket through its day and a minute bucket for an hour', async () => {
        const midnight = Date.parse('2026-10-16T00:00:00Z');
        const insert = sqlite.query('INSERT INTO rate_limit (bucket, window_start, count) VALUES (?, ?, 1)');
        insert.run('usage:today', midnight);
        insert.run('usage:yesterday', midnight - 86_400_000);
        insert.run('ip:x:login', NOW - 30 * 60_000);
        insert.run('ip:x:old', NOW - 2 * 60 * 60_000);
        await deps.db.batch(rateLimitCleanup(deps.db, NOW));
        const left = (sqlite.query('SELECT bucket FROM rate_limit ORDER BY bucket').all() as { bucket: string }[]).map((row) => row.bucket);
        expect(left).toEqual(['ip:x:login', 'usage:today']);
    });
});
