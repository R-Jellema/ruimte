import { describe, expect, test } from 'bun:test';
import { isUsageDesktopCounter, USAGE_DESKTOP_COUNTERS, USAGE_REPORT_MAX_COUNTERS, UsageDesktopBatchSchema, type UsageDesktopDay } from './index.ts';

function day(overrides: Partial<UsageDesktopDay> = {}): UsageDesktopDay {
    return {
        date: '2026-10-15',
        version: '0.22.0',
        platform: 'darwin',
        arch: 'arm64',
        launcher: 'desktop',
        signedIn: true,
        firstThisWeek: false,
        firstThisMonth: false,
        cohortWeek: '2026-W41',
        counts: { 'commands.menu.settings': 2, 'panels.git': 1, 'starts.local': 1 },
        ...overrides
    };
}

describe('the desktop usage report', () => {
    test('takes counters from the allow-list', () => {
        expect(UsageDesktopBatchSchema.safeParse({ days: [day()] }).success).toBe(true);
    });

    test('refuses a name outside the allow-list, a timing and a field of its own', () => {
        expect(UsageDesktopBatchSchema.safeParse({ days: [day({ counts: { 'commands.menu.view-move-x1': 1 } as UsageDesktopDay['counts'] })] }).success).toBe(
            false
        );
        expect(UsageDesktopBatchSchema.safeParse({ days: [{ ...day(), timings: { startupMs: 900 } }] }).success).toBe(false);
        expect(UsageDesktopBatchSchema.safeParse({ days: [{ ...day(), extra: true }] }).success).toBe(false);
    });

    test('refuses a zero, a day twice and more than a week', () => {
        expect(UsageDesktopBatchSchema.safeParse({ days: [day({ counts: { 'panels.git': 0 } })] }).success).toBe(false);
        expect(UsageDesktopBatchSchema.safeParse({ days: [day(), day()] }).success).toBe(false);
        const week = Array.from({ length: 8 }, (_, i) => day({ date: `2026-10-${String(10 + i).padStart(2, '0')}` }));
        expect(UsageDesktopBatchSchema.safeParse({ days: week }).success).toBe(false);
    });

    test('refuses a day with more counters than Observatory takes', () => {
        const counts = Object.fromEntries(USAGE_DESKTOP_COUNTERS.slice(0, USAGE_REPORT_MAX_COUNTERS + 1).map((name) => [name, 1]));

        expect(UsageDesktopBatchSchema.safeParse({ days: [day({ counts })] }).success).toBe(false);
    });

    test('names only what Observatory takes as a counter', () => {
        const refused = USAGE_DESKTOP_COUNTERS.filter((name) => !/^[A-Za-z][A-Za-z0-9_.]{0,63}$/.test(name));

        expect(refused).toEqual([]);
        expect(new Set(USAGE_DESKTOP_COUNTERS).size).toBe(USAGE_DESKTOP_COUNTERS.length);
    });

    test('tells a name of the list from anything else', () => {
        expect(isUsageDesktopCounter('commands.shortcut.palette')).toBe(true);
        expect(isUsageDesktopCounter('commands.shortcut.agentChat')).toBe(true);
        expect(isUsageDesktopCounter('commands.shortcut.agent-chat-claude')).toBe(false);
        expect(isUsageDesktopCounter('panels.mine')).toBe(false);
        expect(isUsageDesktopCounter(undefined)).toBe(false);
    });
});
