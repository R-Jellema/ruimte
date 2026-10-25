import i18next from 'i18next';
import type { RoutineEntry, RoutineRun, RoutineSchedule } from '@ruimte/contracts';
import { formatClock, formatDateTime, formatDay, formatDuration } from '@adecore/ui/format';

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

/* `Weekdays at 09:00`, `Every Friday at 16:00`, `Once, 26 Oct at 09:00`. */
export function scheduleWords(schedule: RoutineSchedule): string {
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
