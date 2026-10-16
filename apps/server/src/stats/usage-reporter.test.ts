import { beforeEach, describe, expect, test } from 'bun:test';
import { AddressBookRequestError, UsageBatchSchema, type UsageBatch } from '@ruimte/pulsar';
import { UsageCounter, type UsageStateStore } from './usage-counter.ts';
import { UsageReporter, usageDayOf } from './usage-reporter.ts';

const DAY = 86_400_000;
const MINUTE = 60_000;

let clock: number;
let sent: UsageBatch[];
let answer: () => Promise<void>;
let enabled: boolean;

const store: UsageStateStore = { read: async () => null, write: async () => undefined };

function counterOf(): UsageCounter {
    return new UsageCounter({ store, describe: () => ({ version: '1.2.3', launcher: 'service' }), now: () => clock, schedule: () => () => undefined });
}

function reporterOf(counter: UsageCounter): UsageReporter {
    return new UsageReporter({
        counter,
        enabled: () => enabled,
        signedIn: async () => true,
        now: () => clock,
        send: (batch) => {
            sent.push(batch);
            return answer();
        }
    });
}

beforeEach(() => {
    clock = Date.parse('2026-10-14T10:00:00Z');
    sent = [];
    answer = async () => undefined;
    enabled = true;
});

describe('sending the usage counts', () => {
    test('sends the finished days once, as the address book takes them', async () => {
        const counter = counterOf();
        const reporter = reporterOf(counter);
        counter.count('projectsOpened');
        counter.startup(900);
        counter.startup(1500);
        counter.startup(1200);
        await reporter.flush();
        expect(sent).toEqual([]);

        clock += DAY;
        await reporter.flush();
        expect(sent).toHaveLength(1);
        expect(UsageBatchSchema.safeParse(sent[0]).success).toBe(true);
        expect(sent[0]!.days).toEqual([
            {
                date: '2026-10-14',
                version: '1.2.3',
                platform: expect.any(String),
                arch: expect.any(String),
                launcher: 'service',
                signedIn: true,
                firstThisWeek: true,
                firstThisMonth: true,
                cohortWeek: '2026-W42',
                startupMs: 1200,
                counts: { projectsOpened: 1 }
            }
        ]);

        await reporter.flush();
        expect(sent).toHaveLength(1);
    });

    test('keeps the days after a failure and tries again ten minutes later', async () => {
        const counter = counterOf();
        const reporter = reporterOf(counter);
        counter.count('launchesRun');
        clock += DAY;
        answer = () => Promise.reject(new AddressBookRequestError('network', 0, 'offline'));
        await reporter.flush();
        expect(sent).toHaveLength(1);

        clock += 5 * MINUTE;
        await reporter.flush();
        expect(sent).toHaveLength(1);

        answer = () => Promise.reject(new AddressBookRequestError('bad-answer', 503, 'down'));
        clock += 6 * MINUTE;
        await reporter.flush();
        expect(sent).toHaveLength(2);

        answer = async () => undefined;
        clock += 11 * MINUTE;
        await reporter.flush();
        expect(sent).toHaveLength(3);
        expect(counter.finished()).toEqual([]);
    });

    test('drops the days the address book refused with 400', async () => {
        const counter = counterOf();
        const reporter = reporterOf(counter);
        counter.count('launchesRun');
        clock += DAY;
        answer = () => Promise.reject(new AddressBookRequestError('bad-request', 400, 'no'));
        await reporter.flush();
        expect(counter.finished()).toEqual([]);
    });

    test('sends nothing while the switch is off', async () => {
        const counter = counterOf();
        const reporter = reporterOf(counter);
        counter.count('launchesRun');
        clock += DAY;
        enabled = false;
        await reporter.flush();
        expect(sent).toEqual([]);
    });

    test('never sends a day older than seven days', async () => {
        const counter = counterOf();
        const reporter = reporterOf(counter);
        counter.count('launchesRun');
        clock += 9 * DAY;
        await reporter.flush();
        expect(sent).toEqual([]);
    });
});

describe('a day as the address book takes it', () => {
    const record = {
        date: '2026-10-14',
        version: '1.2.3',
        launcher: 'desktop' as const,
        signedIn: false,
        firstThisWeek: false,
        firstThisMonth: false,
        startups: [],
        counts: { projectsOpened: 250_000, launchesRun: 0 }
    };

    test('clamps a count, leaves out zeros and maps an unknown platform', () => {
        expect(usageDayOf(record, '2026-W40', 'freebsd', 'ia32')).toMatchObject({
            platform: 'other',
            arch: 'other',
            counts: { projectsOpened: 100_000 }
        });
        expect(usageDayOf(record, '2026-W40', 'linux', 'x64')?.startupMs).toBeUndefined();
    });

    test('is none for a version that is not a release', () => {
        expect(usageDayOf({ ...record, version: 'dev' }, '2026-W40')).toBeNull();
    });
});
