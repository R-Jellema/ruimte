import { describe, expect, test } from 'bun:test';
import { UsageDesktopBatchSchema, type UsageDesktopBatch } from '@ruimte/pulsar';
import {
    countFromPage,
    DesktopUsage,
    desktopUsageDayOf,
    flushDesktopUsage,
    usageCounts,
    usageSettingOf,
    UsageSendError,
    type DesktopUsageStore
} from './usage';

const DAY_MS = 86_400_000;
const START = Date.parse('2026-10-15T10:00:00Z');

function memoryStore(text: string | null = null): DesktopUsageStore & { text: string | null; writes: number } {
    const store = {
        text,
        writes: 0,
        read: () => store.text,
        write: (next: string) => {
            store.text = next;
            store.writes += 1;
        }
    };
    return store;
}

interface Harness {
    usage: DesktopUsage;
    store: ReturnType<typeof memoryStore>;
    clock: { now: number };
    switch: { on: boolean };
    scheduled: (() => void)[];
}

function harness(options: { version?: string; text?: string | null } = {}): Harness {
    const store = memoryStore(options.text ?? null);
    const clock = { now: START };
    const toggle = { on: true };
    const scheduled: (() => void)[] = [];
    const usage = new DesktopUsage({
        store,
        version: options.version ?? '0.22.0',
        enabled: () => toggle.on,
        now: () => clock.now,
        schedule: (run) => {
            scheduled.push(run);
            return () => scheduled.splice(scheduled.indexOf(run), 1);
        }
    });
    usage.load();
    return { usage, store, clock, switch: toggle, scheduled };
}

function flushOptions(sent: UsageDesktopBatch[], answer: () => Promise<void> = () => Promise.resolve()) {
    return {
        send: (batch: UsageDesktopBatch) => {
            sent.push(batch);
            return answer();
        },
        signedIn: () => Promise.resolve(true),
        platform: 'darwin',
        arch: 'arm64'
    };
}

describe('usageCounts', () => {
    test('counts only in a release with a machine of its own whose switch is on', () => {
        expect(usageCounts({ release: true, mode: 'local', setting: true })).toBe(true);
        expect(usageCounts({ release: false, mode: 'local', setting: true })).toBe(false);
        expect(usageCounts({ release: true, mode: 'none', setting: true })).toBe(false);
        expect(usageCounts({ release: true, mode: 'ask', setting: true })).toBe(false);
        expect(usageCounts({ release: true, mode: 'local', setting: false })).toBe(false);
        expect(usageCounts({ release: true, mode: 'local', setting: null })).toBe(false);
    });
});

describe('usageSettingOf', () => {
    test('reads the switch as on unless the machine wrote false, and as unknown without a file that reads', () => {
        expect(usageSettingOf('{"id":"x"}')).toBe(true);
        expect(usageSettingOf('{"usageStats":true}')).toBe(true);
        expect(usageSettingOf('{"usageStats":false}')).toBe(false);
        expect(usageSettingOf(null)).toBeNull();
        expect(usageSettingOf('{not json')).toBeNull();
        expect(usageSettingOf('null')).toBeNull();
    });
});

describe('DesktopUsage', () => {
    test('counts per UTC day and writes at most once per scheduled minute', () => {
        const { usage, store, clock, scheduled } = harness();

        usage.count('windows.opened');
        usage.count('windows.opened');
        clock.now += DAY_MS;
        usage.count('panels.git');

        expect(scheduled).toHaveLength(1);
        expect(store.writes).toBe(0);

        scheduled[0]!();

        const written = JSON.parse(store.text ?? '{}') as { days: { date: string; counts: Record<string, number> }[] };

        expect(store.writes).toBe(1);
        expect(written.days.map((day) => [day.date, day.counts])).toEqual([
            ['2026-10-15', { 'windows.opened': 2 }],
            ['2026-10-16', { 'panels.git': 1 }]
        ]);
        expect(usage.finished().map((day) => day.date)).toEqual(['2026-10-15']);
    });

    test('drops a name from the page that is not on the list', () => {
        const { usage, clock } = harness();

        countFromPage(usage, 'commands.menu.settings');
        countFromPage(usage, 'commands.menu.view-move-abc123');
        countFromPage(usage, 'commands.palette./Users/jane/secret');
        countFromPage(usage, 42);
        clock.now += DAY_MS;

        expect(usage.finished()[0]?.counts).toEqual({ 'commands.menu.settings': 1 });
    });

    test('counts nothing while the switch is off and deletes the days not sent yet', () => {
        const { usage, store, clock, switch: toggle } = harness();

        usage.count('windows.opened');
        clock.now += DAY_MS;
        toggle.on = false;
        usage.count('windows.opened');

        expect(usage.finished()).toEqual([]);
        expect(JSON.parse(store.text ?? '{}')).toMatchObject({ days: [], lastWeek: null, lastMonth: null });

        toggle.on = true;
        usage.count('windows.opened');

        expect(usage.finished()).toEqual([]);
        clock.now += DAY_MS;
        expect(usage.finished()[0]).toMatchObject({ date: '2026-10-16', firstThisWeek: true, firstThisMonth: true });
    });

    test('marks the first day of a week and of a month', () => {
        const { usage, clock } = harness();

        usage.count('windows.opened');
        clock.now += DAY_MS;
        usage.count('windows.opened');
        clock.now += DAY_MS;

        expect(usage.finished().map((day) => [day.date, day.firstThisWeek, day.firstThisMonth])).toEqual([
            ['2026-10-16', false, false],
            ['2026-10-15', true, true]
        ]);
    });

    test('counts a start by its machine mode, and an update when the version moved since the last start', () => {
        const first = harness({ version: '0.21.0' });
        first.usage.started('local');
        first.usage.persist();

        const second = harness({ version: '0.22.0', text: first.store.text });
        second.usage.started('local');
        second.clock.now += DAY_MS;

        expect(second.usage.finished()[0]?.counts).toEqual({ 'starts.local': 2, 'updates.installed': 1 });
    });

    test('keeps the version with the switch off, so turning it back on later counts no update', () => {
        const off = harness({ version: '0.21.0' });
        off.switch.on = false;
        off.usage.started('local');
        off.usage.persist();

        const on = harness({ version: '0.21.0', text: off.store.text });
        on.usage.started('local');
        on.clock.now += DAY_MS;

        expect(on.usage.finished()[0]?.counts).toEqual({ 'starts.local': 1 });
    });

    test('keeps today and the seven days before it', () => {
        const { usage, clock } = harness();

        for (let i = 0; i < 10; i += 1) {
            usage.count('windows.opened');
            clock.now += DAY_MS;
        }
        usage.count('windows.opened');

        expect(usage.finished()).toHaveLength(7);
        expect(usage.finished().at(-1)?.date).toBe('2026-10-18');
    });

    test('starts over on a file it does not read', () => {
        const { usage, clock } = harness({ text: '{"version":2}' });

        usage.count('windows.opened');
        clock.now += DAY_MS;

        expect(usage.finished()).toHaveLength(1);
        expect(usage.firstDate).toBe('2026-10-15');
    });
});

describe('desktopUsageDayOf', () => {
    test('is a day of the batch Observatory takes, from the desktop launcher, without zeros or names it does not know', () => {
        const day = desktopUsageDayOf(
            {
                date: '2026-10-15',
                version: '0.22.0',
                signedIn: true,
                firstThisWeek: true,
                firstThisMonth: false,
                counts: { 'commands.shortcut.palette': 3, 'panels.files': 0, 'commands.menu.fromANewerVersion': 1, 'windows.opened': 200_000 }
            },
            '2026-W40',
            'freebsd',
            'ia32'
        );

        expect(day).toEqual({
            date: '2026-10-15',
            version: '0.22.0',
            platform: 'other',
            arch: 'other',
            launcher: 'desktop',
            signedIn: true,
            firstThisWeek: true,
            firstThisMonth: false,
            cohortWeek: '2026-W40',
            counts: { 'commands.shortcut.palette': 3, 'windows.opened': 100_000 }
        });
        expect(UsageDesktopBatchSchema.safeParse({ days: [day] }).success).toBe(true);
    });

    test('is null for a day the ingest would refuse', () => {
        const record = { date: '2026-10-15', version: 'dev', signedIn: false, firstThisWeek: false, firstThisMonth: false, counts: {} };

        expect(desktopUsageDayOf(record, '2026-W40', 'darwin', 'arm64')).toBeNull();
    });
});

describe('flushDesktopUsage', () => {
    test('sends the finished days once, newest first, and keeps today', async () => {
        const { usage, clock } = harness();
        const sent: UsageDesktopBatch[] = [];

        usage.count('windows.opened');
        clock.now += DAY_MS;
        usage.count('dialogs.settings');
        clock.now += DAY_MS;
        usage.count('panels.git');
        await flushDesktopUsage(usage, flushOptions(sent));
        await flushDesktopUsage(usage, flushOptions(sent));

        expect(sent).toHaveLength(1);
        expect(sent[0]?.days.map((day) => [day.date, day.counts, day.cohortWeek])).toEqual([
            ['2026-10-16', { 'dialogs.settings': 1 }, '2026-W42'],
            ['2026-10-15', { 'windows.opened': 1 }, '2026-W42']
        ]);
        expect(usage.finished()).toEqual([]);
    });

    test('sends nothing with the switch off', async () => {
        const { usage, clock, switch: toggle } = harness();
        const sent: UsageDesktopBatch[] = [];

        usage.count('windows.opened');
        clock.now += DAY_MS;
        toggle.on = false;
        await flushDesktopUsage(usage, flushOptions(sent));

        expect(sent).toEqual([]);
    });

    test('keeps the days after a failure, and drops them after a 400', async () => {
        const { usage, clock } = harness();
        const sent: UsageDesktopBatch[] = [];

        usage.count('windows.opened');
        clock.now += DAY_MS;
        await flushDesktopUsage(
            usage,
            flushOptions(sent, () => Promise.reject(new UsageSendError(503)))
        );

        expect(usage.finished()).toHaveLength(1);

        await flushDesktopUsage(
            usage,
            flushOptions(sent, () => Promise.reject(new UsageSendError(400)))
        );

        expect(usage.finished()).toEqual([]);
    });
});
