import { describe, expect, test } from 'bun:test';
import { dueTimesBetween, nextDue, wallTimeOf, zonedTime } from './routine-schedule.ts';
import { RoutineScheduleSchema } from './routine.ts';

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

describe('an interval', () => {
    const hourly = { kind: 'interval' as const, days: [1, 2, 3, 4, 5], every: 60, from: '09:00', to: '17:00' };

    test('runs from its start up to and including its end', () => {
        const monday = zonedTime(2026, 10, 26, 0, 0, AMS);
        const times = dueTimesBetween(hourly, monday, zonedTime(2026, 10, 26, 23, 59, AMS), AMS);
        expect(times.map(wall)).toEqual([
            '2026-10-26 09:00',
            '2026-10-26 10:00',
            '2026-10-26 11:00',
            '2026-10-26 12:00',
            '2026-10-26 13:00',
            '2026-10-26 14:00',
            '2026-10-26 15:00',
            '2026-10-26 16:00',
            '2026-10-26 17:00'
        ]);
    });

    test('after its last time of a day it is due on its next day', () => {
        const friday = zonedTime(2026, 10, 23, 17, 0, AMS);
        expect(wall(nextDue(hourly, friday, AMS)!)).toBe('2026-10-26 09:00');
        expect(wall(nextDue(hourly, friday - 1, AMS)!)).toBe('2026-10-23 17:00');
        expect(wall(nextDue(hourly, zonedTime(2026, 10, 23, 12, 20, AMS), AMS)!)).toBe('2026-10-23 13:00');
    });

    test('keeps its steps when the end is not on one', () => {
        const schedule = { kind: 'interval' as const, days: [1], every: 120, from: '08:30', to: '13:00' };
        const times = dueTimesBetween(schedule, zonedTime(2026, 10, 26, 0, 0, AMS), zonedTime(2026, 10, 27, 0, 0, AMS), AMS);
        expect(times.map(wall)).toEqual(['2026-10-26 08:30', '2026-10-26 10:30', '2026-10-26 12:30']);
    });

    test('the night the clock goes back runs the doubled hour once', () => {
        // 25 Oct 2026: 03:00 CEST goes back to 02:00 CET, so 02:00 to 02:59 happens twice.
        const schedule = { kind: 'interval' as const, days: [7], every: 30, from: '01:00', to: '04:00' };
        const times = dueTimesBetween(schedule, zonedTime(2026, 10, 24, 12, 0, AMS), zonedTime(2026, 10, 25, 12, 0, AMS), AMS);
        expect(times.map((at) => new Date(at).toISOString().slice(11, 16))).toEqual(['23:00', '23:30', '00:00', '00:30', '02:00', '02:30', '03:00']);
        expect(times.map(wall)).toEqual([
            '2026-10-25 01:00',
            '2026-10-25 01:30',
            '2026-10-25 02:00',
            '2026-10-25 02:30',
            '2026-10-25 03:00',
            '2026-10-25 03:30',
            '2026-10-25 04:00'
        ]);
        let cursor = zonedTime(2026, 10, 24, 12, 0, AMS);
        const stepped: number[] = [];
        for (let i = 0; i < times.length; i++) {
            cursor = nextDue(schedule, cursor, AMS)!;
            stepped.push(cursor);
        }
        expect(stepped).toEqual(times);
    });

    test('the night the clock goes forward runs a skipped time after the skip, once', () => {
        // 29 Mar 2026: 02:00 CET jumps to 03:00 CEST, so 02:00 and 02:30 meet 03:00 and 03:30.
        const schedule = { kind: 'interval' as const, days: [7], every: 30, from: '01:00', to: '04:00' };
        const times = dueTimesBetween(schedule, zonedTime(2026, 3, 28, 12, 0, AMS), zonedTime(2026, 3, 29, 12, 0, AMS), AMS);
        expect(times.map(wall)).toEqual(['2026-03-29 01:00', '2026-03-29 01:30', '2026-03-29 03:00', '2026-03-29 03:30', '2026-03-29 04:00']);
        const lone = { kind: 'interval' as const, days: [7], every: 60, from: '02:30', to: '04:30' };
        const after = dueTimesBetween(lone, zonedTime(2026, 3, 28, 12, 0, AMS), zonedTime(2026, 3, 29, 12, 0, AMS), AMS);
        expect(after.map(wall)).toEqual(['2026-03-29 03:30', '2026-03-29 04:30']);
    });

    test('caps what it hands back', () => {
        const quarterly = { kind: 'interval' as const, days: [1, 2, 3, 4, 5, 6, 7], every: 15, from: '00:00', to: '23:45' };
        const monday = zonedTime(2026, 10, 26, 0, 0, AMS);
        expect(dueTimesBetween(quarterly, monday, monday + 7 * 86_400_000, AMS, 20)).toHaveLength(20);
        expect(dueTimesBetween(quarterly, monday, monday + 7 * 86_400_000, AMS, 1000)).toHaveLength(7 * 96);
    });
});

describe('a cron', () => {
    const cron = (expression: string) => ({ kind: 'cron' as const, expression });

    test('is due at its next matching minute on the machine clock', () => {
        const friday = zonedTime(2026, 10, 23, 10, 0, AMS);
        expect(wall(nextDue(cron('0 9 * * 1-5'), friday, AMS)!)).toBe('2026-10-26 09:00');
        expect(wall(nextDue(cron('0 9 * * 1-5'), friday - 3_600_000 - 1, AMS)!)).toBe('2026-10-23 09:00');
        expect(wall(nextDue(cron('15,45 */6 * * *'), friday, AMS)!)).toBe('2026-10-23 12:15');
        expect(wall(nextDue(cron('0 9 1 * *'), friday, AMS)!)).toBe('2026-11-01 09:00');
        expect(wall(nextDue(cron('@yearly'), friday, AMS)!)).toBe('2027-01-01 00:00');
    });

    test('finds a leap day years ahead', () => {
        expect(wall(nextDue(cron('0 9 29 feb *'), zonedTime(2026, 10, 26, 0, 0, AMS), AMS)!)).toBe('2028-02-29 09:00');
        // A weekday field that starts with a star narrows the date: 29 February on a Sunday, first in 2032.
        expect(wall(nextDue(cron('0 9 29 2 */7'), zonedTime(2026, 10, 26, 0, 0, AMS), AMS)!)).toBe('2032-02-29 09:00');
        // Without the star either matches, so the first Monday of February comes first.
        expect(wall(nextDue(cron('0 9 29 2 mon'), zonedTime(2026, 10, 26, 0, 0, AMS), AMS)!)).toBe('2027-02-01 09:00');
    });

    test('lists its times in a window', () => {
        const monday = zonedTime(2026, 10, 26, 0, 0, AMS);
        const times = dueTimesBetween(cron('30 8,12 * * mon,wed'), monday, monday + 7 * 86_400_000, AMS);
        expect(times.map(wall)).toEqual(['2026-10-26 08:30', '2026-10-26 12:30', '2026-10-28 08:30', '2026-10-28 12:30']);
    });

    test('the night the clock goes back runs the doubled hour once', () => {
        const schedule = cron('*/30 1-3 * * sun');
        const times = dueTimesBetween(schedule, zonedTime(2026, 10, 24, 12, 0, AMS), zonedTime(2026, 10, 25, 12, 0, AMS), AMS);
        expect(times.map((at) => new Date(at).toISOString().slice(11, 16))).toEqual(['23:00', '23:30', '00:00', '00:30', '02:00', '02:30']);
        expect(times.map(wall)).toEqual([
            '2026-10-25 01:00',
            '2026-10-25 01:30',
            '2026-10-25 02:00',
            '2026-10-25 02:30',
            '2026-10-25 03:00',
            '2026-10-25 03:30'
        ]);
        let cursor = zonedTime(2026, 10, 24, 12, 0, AMS);
        const stepped: number[] = [];
        for (let i = 0; i < times.length; i++) {
            cursor = nextDue(schedule, cursor, AMS)!;
            stepped.push(cursor);
        }
        expect(stepped).toEqual(times);
    });

    test('the night the clock goes forward runs a skipped time after the skip, once', () => {
        const times = dueTimesBetween(cron('0,30 1-3 29 3 *'), zonedTime(2026, 3, 28, 12, 0, AMS), zonedTime(2026, 3, 29, 12, 0, AMS), AMS);
        expect(times.map(wall)).toEqual(['2026-03-29 01:00', '2026-03-29 01:30', '2026-03-29 03:00', '2026-03-29 03:30']);
        expect(wall(nextDue(cron('30 2 * * *'), zonedTime(2026, 3, 29, 1, 0, AMS), AMS)!)).toBe('2026-03-29 03:30');
    });

    test('caps what it hands back', () => {
        const monday = zonedTime(2026, 10, 26, 0, 0, AMS);
        expect(dueTimesBetween(cron('*/15 * * * *'), monday, monday + 7 * 86_400_000, AMS, 20)).toHaveLength(20);
        expect(dueTimesBetween(cron('*/15 * * * *'), monday, monday + 7 * 86_400_000, AMS, 1000)).toHaveLength(7 * 96);
    });

    test('an expression it does not read is never due', () => {
        expect(nextDue(cron('* * * * *'), 0, AMS)).toBeNull();
        expect(dueTimesBetween(cron('nonsense'), 0, 86_400_000, AMS)).toEqual([]);
    });
});

describe('RoutineScheduleSchema', () => {
    test('takes an interval in quarter hours with its end after its start', () => {
        const interval = { kind: 'interval', days: [1], every: 30, from: '09:00', to: '17:00' };
        expect(RoutineScheduleSchema.safeParse(interval).success).toBe(true);
        expect(RoutineScheduleSchema.safeParse({ ...interval, every: 20 }).success).toBe(false);
        expect(RoutineScheduleSchema.safeParse({ ...interval, every: 735 }).success).toBe(false);
        expect(RoutineScheduleSchema.safeParse({ ...interval, to: '09:00' }).success).toBe(false);
        expect(RoutineScheduleSchema.safeParse({ ...interval, days: [] }).success).toBe(false);
    });
});
