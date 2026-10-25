import type { RoutineSchedule } from './routine.ts';

/* Shared by the daemon, which owes a routine its times, and a client, which draws them in a week. */

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export interface WallTime {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    // ISO: 1 is Monday.
    weekday: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterOf(timeZone: string): Intl.DateTimeFormat {
    let formatter = formatters.get(timeZone);
    if (formatter === undefined) {
        formatter = new Intl.DateTimeFormat('en-US', {
            timeZone,
            hourCycle: 'h23',
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            weekday: 'short'
        });
        formatters.set(timeZone, formatter);
    }
    return formatter;
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/* The wall clock of `at` in a time zone. */
export function wallTimeOf(at: number, timeZone: string): WallTime {
    const parts = Object.fromEntries(
        formatterOf(timeZone)
            .formatToParts(at)
            .map((part) => [part.type, part.value])
    );
    return {
        year: Number(parts.year),
        month: Number(parts.month),
        day: Number(parts.day),
        hour: Number(parts.hour),
        minute: Number(parts.minute),
        weekday: WEEKDAYS[parts.weekday ?? 'Mon'] ?? 1
    };
}

function offsetAt(at: number, timeZone: string): number {
    const wall = wallTimeOf(at, timeZone);
    return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute) - Math.floor(at / MINUTE_MS) * MINUTE_MS;
}

/*
 * The moment a wall time happens in a time zone. A time the clock skips as it goes forward happens
 * as late as the skip, the way a person's alarm would; a time that happens twice as the clock goes
 * back is its first time, so a routine runs that night once.
 */
export function zonedTime(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): number {
    const asUtc = Date.UTC(year, month - 1, day, hour, minute);
    const candidates = new Set<number>();
    for (const probe of [asUtc - DAY_MS, asUtc, asUtc + DAY_MS]) {
        candidates.add(asUtc - offsetAt(probe, timeZone));
    }
    const exact = [...candidates].filter((at) => {
        const wall = wallTimeOf(at, timeZone);
        return wall.year === year && wall.month === month && wall.day === day && wall.hour === hour && wall.minute === minute;
    });
    if (exact.length > 0) {
        return Math.min(...exact);
    }
    // In a gap: the wall time read with the offset from before the jump, which lands after it.
    return asUtc - offsetAt(asUtc - DAY_MS, timeZone);
}

function clockOf(time: string): { hour: number; minute: number } {
    const [hour, minute] = time.split(':').map(Number);
    return { hour: hour ?? 0, minute: minute ?? 0 };
}

/* The first time the schedule is due strictly after `after`; null for a once that is past. */
export function nextDue(schedule: RoutineSchedule, after: number, timeZone: string): number | null {
    const { hour, minute } = clockOf(schedule.time);
    if (schedule.kind === 'once') {
        const [year, month, day] = schedule.date.split('-').map(Number);
        const at = zonedTime(year!, month!, day!, hour, minute, timeZone);
        return at > after ? at : null;
    }
    const days = new Set(schedule.days);
    const start = wallTimeOf(after, timeZone);
    // Eight days covers every weekday once past today, whatever today's time.
    for (let offset = 0; offset <= 8; offset++) {
        const date = new Date(Date.UTC(start.year, start.month - 1, start.day + offset));
        const weekday = ((date.getUTCDay() + 6) % 7) + 1;
        if (!days.has(weekday)) {
            continue;
        }
        const at = zonedTime(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), hour, minute, timeZone);
        if (at > after) {
            return at;
        }
    }
    return null;
}

/* Every due time in `(from, to]`, oldest first, at most `limit`. */
export function dueTimesBetween(schedule: RoutineSchedule, from: number, to: number, timeZone: string, limit = 50): number[] {
    const times: number[] = [];
    let cursor = from;
    while (times.length < limit) {
        const next = nextDue(schedule, cursor, timeZone);
        if (next === null || next > to) {
            break;
        }
        times.push(next);
        cursor = next;
    }
    return times;
}
