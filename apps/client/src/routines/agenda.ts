import { dueTimesBetween, wallTimeOf, zonedTime, type RoutineEntry, type RoutineRun, type RoutineSchedule } from '@ruimte/contracts';

const DAY_MS = 24 * 60 * 60 * 1000;

/* What a block in the week says about its run. `next` and a `paused` without a run are times the client works out from the schedule. */
export type BlockLook = 'done' | 'waited' | 'caught-up' | 'limit' | 'skipped' | 'paused' | 'next' | 'running' | 'waiting' | 'failed';

export const LEGEND: readonly BlockLook[] = ['done', 'running', 'waiting', 'caught-up', 'failed', 'next'];

export interface AgendaDay {
    /* Epoch ms of midnight in the machine's time zone, and of the next one. */
    start: number;
    end: number;
    /* `YYYY-MM-DD` in the machine's time zone. */
    date: string;
    /* ISO: 1 is Monday. */
    weekday: number;
}

export interface AgendaWeek {
    days: AgendaDay[];
    start: number;
    end: number;
    /* The ISO week number of its Monday. */
    number: number;
}

export interface AgendaBlock {
    key: string;
    day: number;
    at: number;
    look: BlockLook;
    run: RoutineRun | null;
}

function pad(value: number): string {
    return String(value).padStart(2, '0');
}

function isoWeekNumber(year: number, month: number, day: number): number {
    const date = new Date(Date.UTC(year, month - 1, day));
    const weekday = ((date.getUTCDay() + 6) % 7) + 1;
    // The Thursday of a week decides its year.
    date.setUTCDate(date.getUTCDate() + 4 - weekday);
    const firstOfYear = Date.UTC(date.getUTCFullYear(), 0, 1);
    return Math.ceil(((date.getTime() - firstOfYear) / DAY_MS + 1) / 7);
}

/* The week, Monday first, `offset` weeks from the one `now` falls in, by the wall clock of the machine. */
export function weekOf(now: number, timeZone: string, offset: number): AgendaWeek {
    const wall = wallTimeOf(now, timeZone);
    const monday = new Date(Date.UTC(wall.year, wall.month - 1, wall.day - (wall.weekday - 1) + offset * 7));
    const days = Array.from({ length: 7 }, (_, index): AgendaDay => {
        const date = new Date(monday.getTime() + index * DAY_MS);
        const next = new Date(date.getTime() + DAY_MS);
        const year = date.getUTCFullYear();
        const month = date.getUTCMonth() + 1;
        const day = date.getUTCDate();
        return {
            start: zonedTime(year, month, day, 0, 0, timeZone),
            end: zonedTime(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, timeZone),
            date: `${year}-${pad(month)}-${pad(day)}`,
            weekday: index + 1
        };
    });
    return {
        days,
        start: days[0]!.start,
        end: days[6]!.end,
        number: isoWeekNumber(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate())
    };
}

export function lookOfRun(run: RoutineRun): BlockLook {
    switch (run.state) {
        case 'skipped':
            return run.skipped === 'paused' ? 'paused' : 'skipped';
        case 'limit':
            return 'limit';
        case 'needs-you':
            return 'waiting';
        case 'starting':
        case 'running':
            return 'running';
        case 'failed':
            return 'failed';
        case 'done':
            if (run.waited === true) {
                return 'waited';
            }
            return run.kind === 'caught-up' ? 'caught-up' : 'done';
    }
}

function dayIndexOf(week: AgendaWeek, at: number): number {
    return week.days.findIndex((day) => at >= day.start && at < day.end);
}

/* Whether the machine owes this routine its times: approved as it stands and not said no to. */
export function scheduled(entry: RoutineEntry): boolean {
    return entry.approved && entry.local.declined !== entry.digest;
}

/*
 * The blocks of one routine in a week: a block per run it had, and its coming times from the schedule.
 * A run sits on the day it was due, so a caught-up run stays on the morning it missed.
 */
export function blocksOf(entry: RoutineEntry, week: AgendaWeek, now: number, timeZone: string): AgendaBlock[] {
    const blocks: AgendaBlock[] = [];
    for (const run of entry.runs) {
        const day = dayIndexOf(week, run.due);
        if (day >= 0) {
            blocks.push({ key: run.runId, day, at: run.due, look: lookOfRun(run), run });
        }
    }
    if (scheduled(entry) && week.end > now) {
        const taken = new Set(entry.runs.map((run) => run.due));
        const paused = entry.local.pausedAt !== undefined;
        for (const at of dueTimesBetween(entry.routine.schedule, Math.max(now, week.start - 1), week.end - 1, timeZone)) {
            if (!taken.has(at)) {
                blocks.push({ key: `next-${at}`, day: dayIndexOf(week, at), at, look: paused ? 'paused' : 'next', run: null });
            }
        }
    }
    return blocks.sort((left, right) => left.at - right.at);
}

/*
 * The days of the week a paused routine draws as one band: from today, or the week's first day ahead of
 * now, to its end, past the days that still hold a run. Null when it is not paused or the week is past.
 */
export function pausedBand(entry: RoutineEntry, blocks: readonly AgendaBlock[], week: AgendaWeek, now: number): { from: number; to: number } | null {
    if (entry.local.pausedAt === undefined || !scheduled(entry) || week.end <= now) {
        return null;
    }
    let from = week.start > now ? 0 : Math.max(0, dayIndexOf(week, now));
    while (from < 7 && blocks.some((block) => block.day === from && block.run !== null)) {
        from++;
    }
    return from > 6 ? null : { from, to: 6 };
}

/* The runs a pause skipped since it began. */
export function skippedWhilePaused(entry: RoutineEntry): number {
    const since = entry.local.pausedAt;
    if (since === undefined) {
        return 0;
    }
    return entry.runs.filter((run) => run.state === 'skipped' && run.skipped === 'paused' && run.due >= since).length;
}

/* The routines waiting on a person's approval here: held, and not already said no to as they stand. */
export function awaitingApproval(entries: readonly RoutineEntry[]): RoutineEntry[] {
    return entries.filter((entry) => entry.held !== undefined && entry.local.declined !== entry.digest);
}

/* The runs that wait on a person now, newest first. */
export function runsWaiting(entries: readonly RoutineEntry[]): Array<{ entry: RoutineEntry; run: RoutineRun }> {
    return entries
        .flatMap((entry) => entry.runs.filter((run) => run.state === 'needs-you').map((run) => ({ entry, run })))
        .sort((left, right) => right.run.at - left.run.at);
}

/* The schedule's days for a drag across the week: one day is that date once, more are those weekdays. */
export function scheduleForDays(week: AgendaWeek, from: number, to: number, time: string): RoutineSchedule {
    const first = Math.min(from, to);
    const last = Math.max(from, to);
    if (first === last) {
        return { kind: 'once', date: week.days[first]!.date, time };
    }
    return { kind: 'weekly', days: week.days.slice(first, last + 1).map((day) => day.weekday), time };
}

/* A short id a routine is named by in its files, out of its title, that none of the project's others has. */
export function freshRoutineId(title: string, taken: ReadonlySet<string>): string {
    const base =
        title
            .toLowerCase()
            .normalize('NFKD')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 48) || 'routine';
    let candidate = base;
    for (let count = 2; taken.has(candidate); count++) {
        candidate = `${base}-${count}`;
    }
    return candidate;
}
