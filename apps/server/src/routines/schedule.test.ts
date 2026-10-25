import { describe, expect, test } from 'bun:test';
import { dueTimesBetween, nextDue, wallTimeOf, zonedTime } from './schedule.ts';

const AMS = 'Europe/Amsterdam';

function wall(at: number): string {
    const time = wallTimeOf(at, AMS);
    const pad = (value: number): string => String(value).padStart(2, '0');
    return `${time.year}-${pad(time.month)}-${pad(time.day)} ${pad(time.hour)}:${pad(time.minute)}`;
}

describe('nextDue', () => {
    test('a weekday routine skips the weekend', () => {
        // Friday 23 Oct 2026 10:00 in Amsterdam.
        const friday = zonedTime(2026, 10, 23, 10, 0, AMS);
        const next = nextDue({ kind: 'weekly', days: [1, 2, 3, 4, 5], time: '09:00' }, friday, AMS);
        expect(wall(next!)).toBe('2026-10-26 09:00');
    });

    test('a time later today is due today', () => {
        const morning = zonedTime(2026, 10, 21, 8, 0, AMS);
        expect(wall(nextDue({ kind: 'weekly', days: [3], time: '09:00' }, morning, AMS)!)).toBe('2026-10-21 09:00');
    });

    test('a once in the past is due never', () => {
        const after = zonedTime(2026, 10, 26, 23, 0, AMS);
        expect(nextDue({ kind: 'once', date: '2026-10-26', time: '22:00' }, after, AMS)).toBeNull();
        expect(wall(nextDue({ kind: 'once', date: '2026-10-26', time: '22:00' }, after - 2 * 3_600_000, AMS)!)).toBe('2026-10-26 22:00');
    });

    test('the night the clock goes back runs a 02:30 routine once', () => {
        // 25 Oct 2026: 03:00 CEST goes back to 02:00 CET, so 02:30 happens twice.
        const schedule = { kind: 'weekly' as const, days: [1, 2, 3, 4, 5, 6, 7], time: '02:30' };
        const evening = zonedTime(2026, 10, 24, 20, 0, AMS);
        const first = nextDue(schedule, evening, AMS)!;
        expect(new Date(first).toISOString()).toBe('2026-10-25T00:30:00.000Z');
        const second = nextDue(schedule, first, AMS)!;
        expect(wall(second)).toBe('2026-10-26 02:30');
        expect(dueTimesBetween(schedule, evening, zonedTime(2026, 10, 25, 12, 0, AMS), AMS)).toEqual([first]);
    });

    test('a time the clock skips forward happens after the skip', () => {
        // 29 Mar 2026: 02:00 CET jumps to 03:00 CEST.
        const at = zonedTime(2026, 3, 29, 2, 30, AMS);
        expect(new Date(at).toISOString()).toBe('2026-03-29T01:30:00.000Z');
        expect(wall(at)).toBe('2026-03-29 03:30');
    });

    test('a daily routine keeps its wall time across the change', () => {
        const schedule = { kind: 'weekly' as const, days: [1, 2, 3, 4, 5, 6, 7], time: '09:00' };
        const times = dueTimesBetween(schedule, zonedTime(2026, 10, 24, 0, 0, AMS), zonedTime(2026, 10, 26, 23, 0, AMS), AMS);
        expect(times.map(wall)).toEqual(['2026-10-24 09:00', '2026-10-25 09:00', '2026-10-26 09:00']);
        expect(times[1]! - times[0]!).toBe(25 * 3_600_000);
    });
});
