import { describe, expect, test } from 'bun:test';
import { cronMatchesDay, cronProblemText, parseCron, type Cron } from './routine-cron.ts';
import { RoutineScheduleSchema } from './routine.ts';

function cron(expression: string): Cron {
    const parsed = parseCron(expression);
    if (!parsed.ok) {
        throw new Error(cronProblemText(parsed.problem));
    }
    return parsed.cron;
}

function problem(expression: string) {
    const parsed = parseCron(expression);
    return parsed.ok ? null : parsed.problem;
}

describe('parseCron', () => {
    test('reads stars, lists, ranges and steps', () => {
        const parsed = cron('0,30 9-17/2 * * *');
        expect(parsed.minutes).toEqual([0, 30]);
        expect(parsed.hours).toEqual([9, 11, 13, 15, 17]);
        expect(parsed.daysOfMonth.size).toBe(31);
        expect(parsed.months.size).toBe(12);
        expect([...parsed.daysOfWeek].sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
        expect(cron('*/15 * * * *').minutes).toEqual([0, 15, 30, 45]);
        expect(cron('10/20 * * * *').minutes).toEqual([10, 30, 50]);
        expect(cron('  0   9 * *  1-5 ').hours).toEqual([9]);
    });

    test('reads month and day names in any case, and 0 and 7 as Sunday', () => {
        const parsed = cron('0 9 * JAN,jul-sep Mon-Fri');
        expect([...parsed.months].sort((left, right) => left - right)).toEqual([1, 7, 8, 9]);
        expect([...parsed.daysOfWeek].sort()).toEqual([1, 2, 3, 4, 5]);
        expect([...cron('0 9 * * 7').daysOfWeek]).toEqual([0]);
        expect([...cron('0 9 * * 5-7').daysOfWeek].sort()).toEqual([0, 5, 6]);
        expect([...cron('0 9 * * sun').daysOfWeek]).toEqual([0]);
    });

    test('reads the macros', () => {
        expect(cron('@daily')).toEqual(cron('0 0 * * *'));
        expect(cron('@hourly')).toEqual(cron('0 * * * *'));
        expect(cron('@weekly')).toEqual(cron('0 0 * * 0'));
        expect(cron('@monthly')).toEqual(cron('0 0 1 * *'));
        expect(cron('@YEARLY')).toEqual(cron('0 0 1 1 *'));
    });

    test('refuses an expression it does not read, and says which field', () => {
        expect(problem('0 9 * *')).toEqual({ kind: 'shape' });
        expect(problem('0 0 9 * * 1')).toEqual({ kind: 'shape' });
        expect(problem('@reboot')).toEqual({ kind: 'shape' });
        expect(problem('')).toEqual({ kind: 'shape' });
        expect(problem('60 9 * * *')).toEqual({ kind: 'field', field: 'minute', part: '60' });
        expect(problem('0 24 * * *')).toEqual({ kind: 'field', field: 'hour', part: '24' });
        expect(problem('0 9 0 * *')).toEqual({ kind: 'field', field: 'dayOfMonth', part: '0' });
        expect(problem('0 9 * 13 *')).toEqual({ kind: 'field', field: 'month', part: '13' });
        expect(problem('0 9 * * 8')).toEqual({ kind: 'field', field: 'dayOfWeek', part: '8' });
        expect(problem('0 9 * * mon-sun')).toEqual({ kind: 'field', field: 'dayOfWeek', part: 'mon-sun' });
        expect(problem('0 17-9 * * *')).toEqual({ kind: 'field', field: 'hour', part: '17-9' });
        expect(problem('*/0 * * * *')).toEqual({ kind: 'field', field: 'minute', part: '*/0' });
        expect(problem('0 9 L * *')).toEqual({ kind: 'field', field: 'dayOfMonth', part: 'L' });
        expect(problem('0 9 * * 1#2')).toEqual({ kind: 'field', field: 'dayOfWeek', part: '1#2' });
        expect(problem('0 9 ? * *')).toEqual({ kind: 'field', field: 'dayOfMonth', part: '?' });
        expect(problem('0,,30 9 * * *')).toEqual({ kind: 'field', field: 'minute', part: '' });
        expect(problem('0 9 * jan *')).toBeNull();
        expect(cronProblemText({ kind: 'field', field: 'hour', part: '24' })).toBe('the hour (0-23) field does not take "24"');
    });

    test('refuses an expression that runs more often than every 15 minutes', () => {
        expect(problem('* * * * *')).toEqual({ kind: 'often' });
        expect(problem('*/10 * * * *')).toEqual({ kind: 'often' });
        expect(problem('0,14 9 * * *')).toEqual({ kind: 'often' });
        // 09:50 and 10:00 are ten minutes apart.
        expect(problem('0,50 9,10 * * *')).toEqual({ kind: 'often' });
        // 23:55 and 00:05 the next day.
        expect(problem('5,55 0,23 * * *')).toEqual({ kind: 'often' });
        expect(problem('*/15 * * * *')).toBeNull();
        expect(problem('0,50 9,11 * * *')).toBeNull();
        expect(problem('0,45 * * * *')).toBeNull();
    });

    test('refuses a date that never comes', () => {
        expect(problem('0 9 31 2 *')).toEqual({ kind: 'never' });
        expect(problem('0 9 30,31 feb *')).toEqual({ kind: 'never' });
        expect(problem('0 9 31 4,6 *')).toEqual({ kind: 'never' });
        expect(problem('0 9 29 2 *')).toBeNull();
        // With a weekday as well, either matches, so it runs on Mondays.
        expect(problem('0 9 31 2 1')).toBeNull();
    });
});

describe('cronMatchesDay', () => {
    test('needs both day fields when one is a star, and either when both are set', () => {
        // 26 Oct 2026 is a Monday, 1 Nov 2026 a Sunday.
        expect(cronMatchesDay(cron('0 9 * * 1'), 2026, 10, 26)).toBe(true);
        expect(cronMatchesDay(cron('0 9 * * 1'), 2026, 10, 27)).toBe(false);
        expect(cronMatchesDay(cron('0 9 1 * *'), 2026, 11, 1)).toBe(true);
        expect(cronMatchesDay(cron('0 9 1 * *'), 2026, 11, 2)).toBe(false);
        const either = cron('0 9 1 * 1');
        expect([cronMatchesDay(either, 2026, 11, 1), cronMatchesDay(either, 2026, 10, 26), cronMatchesDay(either, 2026, 10, 27)]).toEqual([true, true, false]);
        // A field that starts with a star narrows the other, the way Vixie cron reads it.
        const both = cron('0 9 */2 * 1');
        expect([cronMatchesDay(both, 2026, 10, 26), cronMatchesDay(both, 2026, 10, 19), cronMatchesDay(both, 2026, 10, 27)]).toEqual([false, true, false]);
    });

    test('keeps to its months', () => {
        const january = cron('0 9 * jan *');
        expect([cronMatchesDay(january, 2027, 1, 15), cronMatchesDay(january, 2026, 12, 15)]).toEqual([true, false]);
    });
});

describe('a cron schedule', () => {
    test('is taken when it reads and refused with the reason when not', () => {
        expect(RoutineScheduleSchema.safeParse({ kind: 'cron', expression: '0 9 * * 1-5' }).success).toBe(true);
        const refused = RoutineScheduleSchema.safeParse({ kind: 'cron', expression: '*/5 * * * *' });
        expect(refused.success).toBe(false);
        expect(refused.error?.issues[0]?.message).toBe('it would run more often than every 15 minutes');
        expect(refused.error?.issues[0]?.path).toEqual(['expression']);
        expect(RoutineScheduleSchema.safeParse({ kind: 'cron', expression: '' }).success).toBe(false);
    });
});
