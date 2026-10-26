/*
 * A routine's crontab expression: the five fields of Vixie cron (minute, hour, day of month, month, day
 * of week) with `*`, lists, ranges, steps, names and the @ macros. No seconds, no `L`, `W` or `#`, no @reboot.
 */

export type CronField = 'minute' | 'hour' | 'dayOfMonth' | 'month' | 'dayOfWeek';

export type CronProblem = { kind: 'shape' } | { kind: 'field'; field: CronField; part: string } | { kind: 'often' } | { kind: 'never' };

export interface Cron {
    minutes: readonly number[];
    hours: readonly number[];
    daysOfMonth: ReadonlySet<number>;
    months: ReadonlySet<number>;
    // 0 is Sunday, as cron counts.
    daysOfWeek: ReadonlySet<number>;
    // Vixie cron: a day field that starts with `*` narrows the other; when neither does, either one matches.
    eitherDay: boolean;
}

export type CronParse = { ok: true; cron: Cron } | { ok: false; problem: CronProblem };

// The same floor as an interval's step, so no kind of routine runs more often.
export const CRON_MIN_GAP = 15;

const MACROS: Record<string, string> = {
    '@hourly': '0 * * * *',
    '@daily': '0 0 * * *',
    '@midnight': '0 0 * * *',
    '@weekly': '0 0 * * 0',
    '@monthly': '0 0 1 * *',
    '@yearly': '0 0 1 1 *',
    '@annually': '0 0 1 1 *'
};

interface FieldSpec {
    field: CronField;
    min: number;
    max: number;
    names?: readonly string[];
}

const FIELDS: readonly FieldSpec[] = [
    { field: 'minute', min: 0, max: 59 },
    { field: 'hour', min: 0, max: 23 },
    { field: 'dayOfMonth', min: 1, max: 31 },
    { field: 'month', min: 1, max: 12, names: ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] },
    // 7 is Sunday as well as 0.
    { field: 'dayOfWeek', min: 0, max: 7, names: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] }
];

// February counts its leap day, so 29 February is a day that comes.
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function valueOf(text: string, spec: FieldSpec): number | null {
    if (/^\d{1,2}$/.test(text)) {
        const value = Number(text);
        return value >= spec.min && value <= spec.max ? value : null;
    }
    const index = spec.names?.indexOf(text.toLowerCase()) ?? -1;
    return index < 0 ? null : spec.min + index;
}

/* One part of a list: `*`, `5`, `mon-fri`, a range or `*` with a step such as `9-17/2`, or `10/20` (from 10 to the end). */
function partValues(part: string, spec: FieldSpec): number[] | null {
    const [range, stepText, ...rest] = part.split('/');
    if (range === undefined || rest.length > 0) {
        return null;
    }
    let step = 1;
    if (stepText !== undefined) {
        if (!/^\d{1,2}$/.test(stepText) || Number(stepText) < 1) {
            return null;
        }
        step = Number(stepText);
    }
    let first: number | null;
    let last: number | null;
    if (range === '*') {
        first = spec.min;
        last = spec.max;
    } else {
        const [fromText, toText, ...more] = range.split('-');
        if (fromText === undefined || more.length > 0) {
            return null;
        }
        first = valueOf(fromText, spec);
        last = toText !== undefined ? valueOf(toText, spec) : stepText !== undefined ? spec.max : first;
    }
    if (first === null || last === null || first > last) {
        return null;
    }
    const values: number[] = [];
    for (let value = first; value <= last; value += step) {
        values.push(value);
    }
    return values;
}

function fieldValues(text: string, spec: FieldSpec): { values: Set<number> } | { part: string } {
    const values = new Set<number>();
    for (const part of text.split(',')) {
        const partial = partValues(part, spec);
        if (partial === null) {
            return { part };
        }
        for (const value of partial) {
            values.add(spec.field === 'dayOfWeek' && value === 7 ? 0 : value);
        }
    }
    return { values };
}

/* The shortest time between two runs within a day, or across the hour when two hours follow each other. */
function shortestGap(minutes: readonly number[], hours: readonly number[]): number {
    let gap = Infinity;
    for (let i = 1; i < minutes.length; i++) {
        gap = Math.min(gap, minutes[i]! - minutes[i - 1]!);
    }
    const hourSet = new Set(hours);
    // 23 and 0 count as following each other, since both days may run.
    if (hours.some((hour) => hourSet.has((hour + 1) % 24))) {
        gap = Math.min(gap, 60 - minutes[minutes.length - 1]! + minutes[0]!);
    }
    return gap;
}

function sorted(values: ReadonlySet<number>): number[] {
    return [...values].sort((left, right) => left - right);
}

export function parseCron(expression: string): CronParse {
    const trimmed = expression.trim();
    const fields = (MACROS[trimmed.toLowerCase()] ?? trimmed).split(/\s+/);
    if (fields.length !== FIELDS.length) {
        return { ok: false, problem: { kind: 'shape' } };
    }
    const sets: Set<number>[] = [];
    for (const [index, spec] of FIELDS.entries()) {
        const parsed = fieldValues(fields[index]!, spec);
        if ('part' in parsed) {
            return { ok: false, problem: { kind: 'field', field: spec.field, part: parsed.part } };
        }
        sets.push(parsed.values);
    }
    const [minutes, hours, daysOfMonth, months, daysOfWeek] = sets as [Set<number>, Set<number>, Set<number>, Set<number>, Set<number>];
    const cron: Cron = {
        minutes: sorted(minutes),
        hours: sorted(hours),
        daysOfMonth,
        months,
        daysOfWeek,
        eitherDay: !fields[2]!.startsWith('*') && !fields[4]!.startsWith('*')
    };
    if (shortestGap(cron.minutes, cron.hours) < CRON_MIN_GAP) {
        return { ok: false, problem: { kind: 'often' } };
    }
    // When both day fields must match, a weekday comes on every date in some year, so only the date can be missing.
    const someDate = [...months].some((month) => [...daysOfMonth].some((day) => day <= DAYS_IN_MONTH[month - 1]!));
    if (!cron.eitherDay && !someDate) {
        return { ok: false, problem: { kind: 'never' } };
    }
    return { ok: true, cron };
}

/* Whether the expression runs on a calendar day, whatever the time. */
export function cronMatchesDay(cron: Cron, year: number, month: number, day: number): boolean {
    if (!cron.months.has(month)) {
        return false;
    }
    const onDate = cron.daysOfMonth.has(day);
    const onWeekday = cron.daysOfWeek.has(new Date(Date.UTC(year, month - 1, day)).getUTCDay());
    return cron.eitherDay ? onDate || onWeekday : onDate && onWeekday;
}

/* The wall clocks of a day the expression runs on, as minutes past midnight, oldest first. */
export function cronClocks(cron: Cron): number[] {
    return cron.hours.flatMap((hour) => cron.minutes.map((minute) => hour * 60 + minute));
}

const FIELD_WORDS: Record<CronField, string> = {
    minute: 'minute (0-59)',
    hour: 'hour (0-23)',
    dayOfMonth: 'day of month (1-31)',
    month: 'month (1-12 or jan-dec)',
    dayOfWeek: 'day of week (0-7 or sun-sat)'
};

/* A problem in the words an agent or a log reads; a client words it in the person's language itself. */
export function cronProblemText(problem: CronProblem): string {
    switch (problem.kind) {
        case 'shape':
            return 'a cron expression has five fields, minute, hour, day of month, month and day of week, such as "0 9 * * 1-5", or is one of @hourly, @daily, @weekly, @monthly and @yearly';
        case 'field':
            return `the ${FIELD_WORDS[problem.field]} field does not take "${problem.part}"`;
        case 'often':
            return `it would run more often than every ${CRON_MIN_GAP} minutes`;
        case 'never':
            return 'it names a date that never comes, such as 31 February';
    }
}
