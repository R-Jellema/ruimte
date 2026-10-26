import i18next from 'i18next';
import type { RoutineEntry, RoutineRun, RoutineSchedule } from '@ruimte/contracts';
import { formatClock, formatDateTime, formatDay, formatDuration, formatElapsedShort } from '@adecore/ui/format';
import type { AgendaBlock, AgendaWeek, CellItem } from '@/routines/agenda';

// A day's noon, so a date written from its midnight never slips to the day before around a clock change.
const NOON_MS = 12 * 60 * 60 * 1000;

/* A time of a schedule, `HH:MM` on the machine's clock, written the way the region writes a clock. */
export function clockWords(time: string): string {
    const [hour, minute] = time.split(':').map(Number);
    return formatClock(Date.UTC(2000, 0, 3, hour ?? 0, minute ?? 0), 'UTC');
}

// 3 January 2000 was a Monday, so an ISO weekday is that date plus the weekday less one.
function weekdayAt(weekday: number): number {
    return Date.UTC(2000, 0, 2 + weekday, 12, 0);
}

export function weekdayWords(weekday: number, width: 'short' | 'long' = 'short'): string {
    return formatDateTime(weekdayAt(weekday), { weekday: width, timeZone: 'UTC' });
}

const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKEND = [6, 7];

function sameDays(days: readonly number[], expected: readonly number[]): boolean {
    return days.length === expected.length && expected.every((day) => days.includes(day));
}

/* `every 15 minutes`, `every hour`, `every 2 hours`. */
export function everyWords(minutes: number): string {
    if (minutes === 60) {
        return i18next.t('routines:step.hour');
    }
    return minutes % 60 === 0 ? i18next.t('routines:step.hours', { count: minutes / 60 }) : i18next.t('routines:step.minutes', { count: minutes });
}

/* The days of a repeat within a day: `Daily`, `Weekdays`, `Monday`, `Mon, Wed`. */
function intervalDayWords(days: readonly number[]): string {
    if (days.length === 7) {
        return i18next.t('routines:repeatDays.daily');
    }
    if (sameDays(days, WEEKDAYS)) {
        return i18next.t('routines:repeatDays.weekdays');
    }
    if (sameDays(days, WEEKEND)) {
        return i18next.t('routines:repeatDays.weekends');
    }
    return days.length === 1 ? weekdayWords(days[0]!, 'long') : days.map((day) => weekdayWords(day)).join(', ');
}

/* `Weekdays at 09:00`, `Every Friday at 16:00`, `Once, 26 Oct at 09:00`, `Weekdays, every hour from 09:00 to 17:00`. */
export function scheduleWords(schedule: RoutineSchedule): string {
    if (schedule.kind === 'interval') {
        return i18next.t('routines:repeat.interval', {
            days: intervalDayWords([...new Set(schedule.days)].sort((left, right) => left - right)),
            every: everyWords(schedule.every),
            from: clockWords(schedule.from),
            to: clockWords(schedule.to)
        });
    }
    const time = clockWords(schedule.time);
    if (schedule.kind === 'once') {
        const [year, month, day] = schedule.date.split('-').map(Number);
        return i18next.t('routines:repeat.once', { date: formatDay(Date.UTC(year!, month! - 1, day!, 12), 'UTC'), time });
    }
    const days = [...new Set(schedule.days)].sort((left, right) => left - right);
    if (days.length === 7) {
        return i18next.t('routines:repeat.daily', { time });
    }
    if (sameDays(days, WEEKDAYS)) {
        return i18next.t('routines:repeat.weekdays', { time });
    }
    if (sameDays(days, WEEKEND)) {
        return i18next.t('routines:repeat.weekends', { time });
    }
    if (days.length === 1) {
        return i18next.t('routines:repeat.every', { day: weekdayWords(days[0]!, 'long'), time });
    }
    return i18next.t('routines:repeat.some', { days: days.map((day) => weekdayWords(day)).join(', '), time });
}

/* What a drag across the days picked: `Mon to Fri · every weekday`, or `Wed 22 · once` for one day. */
export function spanWords(week: AgendaWeek, from: number, to: number, timeZone: string): string {
    const first = week.days[Math.min(from, to)]!;
    const last = week.days[Math.max(from, to)]!;
    if (first === last) {
        return i18next.t('routines:span.once', { day: formatDateTime(first.start + NOON_MS, { weekday: 'short', day: 'numeric', timeZone }) });
    }
    const days = week.days.slice(first.weekday - 1, last.weekday).map((day) => day.weekday);
    const repeat = days.length === 7 ? 'daily' : sameDays(days, WEEKDAYS) ? 'weekdays' : sameDays(days, WEEKEND) ? 'weekends' : 'weekly';
    return i18next.t('routines:span.range', {
        from: weekdayWords(first.weekday),
        to: weekdayWords(last.weekday),
        repeat: i18next.t(`routines:span.${repeat}`)
    });
}

/* What a block in the week says in its chip: when a run started and how long it took, or what became of it. */
export function blockWords(block: AgendaBlock, timeZone: string): string {
    const t = (key: string, values?: Record<string, string>): string => i18next.t(`routines:chip.${key}`, values);
    const run = block.run;
    const time = formatClock(run?.at ?? block.at, timeZone);
    switch (block.look) {
        case 'done':
        case 'waited':
            return run?.endedAt === undefined ? time : t('took', { time, duration: formatElapsedShort(run.endedAt - run.at) });
        case 'waiting':
            return t('needsYou');
        case 'caught-up':
            return t('woke', { time });
        case 'limit':
            return t('limit');
        case 'failed':
            return t('failed');
        case 'skipped':
            return t('skipped');
        case 'paused':
            return t('paused');
        case 'running':
        case 'next':
            return time;
    }
}

/* What a folded chip of a day says: `9 runs · 1 failed`, or `every hour until 17:00` for the times still to come. */
export function foldWords(item: Exclude<CellItem, { kind: 'block' }>): string {
    if (item.kind === 'coming') {
        return i18next.t('routines:chip.coming', { every: everyWords(item.every), to: clockWords(item.to) });
    }
    const runs = i18next.t('routines:chip.runs', { count: item.blocks.length });
    return item.failed === 0 ? runs : i18next.t('routines:chip.runsFailed', { runs, count: item.failed });
}

/* A moment on the machine's clock with its weekday: `Mon 09:00`. */
export function weekdayClock(at: number, timeZone: string): string {
    return formatDateTime(at, { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone });
}

/* What a row says under its title: when it runs next, that it is paused, or that it waits for you. */
export function rowStatus(entry: RoutineEntry, timeZone: string): { tone: 'needs' | 'muted'; text: string } {
    const waiting = entry.runs.find((run) => run.state === 'needs-you');
    if (waiting !== undefined) {
        return { tone: 'needs', text: i18next.t('routines:row.waits', { time: weekdayClock(waiting.at, timeZone) }) };
    }
    if (entry.held !== undefined && entry.local.declined !== entry.digest) {
        return { tone: 'needs', text: i18next.t('routines:row.held') };
    }
    if (entry.local.declined === entry.digest) {
        return { tone: 'muted', text: i18next.t('routines:row.declined') };
    }
    if (entry.local.pausedAt !== undefined) {
        return { tone: 'muted', text: i18next.t('routines:row.paused') };
    }
    if (entry.next !== null) {
        return { tone: 'muted', text: i18next.t('routines:row.next', { time: weekdayClock(entry.next, timeZone) }) };
    }
    return { tone: 'muted', text: i18next.t('routines:row.ended') };
}

/* A run in the timeline, as a sentence. */
export function runWords(run: RoutineRun, timeZone: string): string {
    const t = (key: string, values?: Record<string, string>): string => i18next.t(`routines:run.${key}`, values);
    const took = (): string => formatDuration(Math.max(0, (run.endedAt ?? run.at) - run.at));
    switch (run.state) {
        case 'skipped':
            return t(run.skipped === 'paused' ? 'skippedPaused' : run.skipped === 'held' ? 'skippedHeld' : 'skippedOverlap');
        case 'starting':
            return t('starting');
        case 'running':
            return t('running', { time: formatClock(run.at, timeZone) });
        case 'needs-you':
            return t('needsYou');
        case 'limit':
            return run.limitUntil === undefined ? t('limit') : t('limitUntil', { time: weekdayClock(run.limitUntil, timeZone) });
        case 'failed':
            if (run.error !== undefined && run.error !== '') {
                return t('failedWith', { error: run.error });
            }
            return run.exitCode === undefined ? t('failed') : t('failedExit', { code: String(run.exitCode) });
        case 'done':
            if (run.kind === 'caught-up') {
                return t('caughtUp', { time: formatClock(run.due, timeZone) });
            }
            if (run.waited === true) {
                return t('waitedDone', { duration: took() });
            }
            return run.kind === 'manual' ? t('doneManual', { duration: took() }) : t('done', { duration: took() });
    }
}
