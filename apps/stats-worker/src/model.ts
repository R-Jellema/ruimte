import { isoWeekOf, type UsageCounter } from '@ruimte/pulsar';
import { addDays, type Segment, type UsageRow } from './queries.ts';

export interface Point {
    label: string;
    value: number;
}

export interface Series {
    name: string;
    // Null where the day has no value at all, which a line leaves open rather than drawing as zero.
    points: { label: string; value: number | null }[];
}

export interface CohortRow {
    week: string;
    size: number;
    // The share of the cohort active in each week since its first, from week 0; null for a week still to come.
    shares: (number | null)[];
}

export interface Dashboard {
    from: string;
    to: string;
    hasData: boolean;
    tiles: { label: string; value: number | null; note: string }[];
    daily: Series;
    weekly: Series;
    monthly: Series;
    versions: Point[];
    platforms: Point[];
    arches: Point[];
    launchers: Point[];
    signedIn: Point[];
    features: { title: string; items: Point[] }[];
    chats: Point[];
    turns: Point[];
    retention: CohortRow[];
    startup: Series[];
}

// A label for every counter the dashboard shows, grouped the way it shows them.
export const FEATURE_GROUPS: readonly { title: string; counters: readonly (readonly [UsageCounter, string])[] }[] = [
    {
        title: 'Work',
        counters: [
            ['projectsOpened', 'Projects opened'],
            ['terminalsStarted', 'Terminals started'],
            ['agentsDelegated', 'Agents delegated'],
            ['teamsDelegated', 'Teams delegated'],
            ['launchesRun', 'Launches run'],
            ['worktreeMerges', 'Worktree merges']
        ]
    },
    {
        title: 'Views opened',
        counters: [
            ['viewsCanvas', 'Canvas'],
            ['viewsChat', 'Chat'],
            ['viewsTerminal', 'Terminal'],
            ['viewsFile', 'File'],
            ['viewsBrowser', 'Browser'],
            ['viewsDevice', 'Device'],
            ['viewsDrawing', 'Drawing'],
            ['viewsDiagram', 'Diagram'],
            ['viewsDatabase', 'Database']
        ]
    },
    {
        title: 'ruimte-context verbs',
        counters: [
            ['verbsRead', 'help, list, read'],
            ['verbsTask', 'done, task, plan, answer'],
            ['verbsMessage', 'notify, alert, flag, chat'],
            ['verbsAgent', 'agent, team'],
            ['verbsCanvas', 'node, link, view, ui, project, visual'],
            ['verbsBrowser', 'browser'],
            ['verbsDevice', 'device'],
            ['verbsDatabase', 'database'],
            ['verbsComputer', 'computer'],
            ['verbsWorktree', 'worktree'],
            ['verbsLaunches', 'launches, operation'],
            ['verbsSecret', 'secret'],
            ['verbsLanguage', 'language']
        ]
    },
    {
        title: 'Remote clients connected',
        counters: [
            ['clientsDesktop', 'Desktop'],
            ['clientsIos', 'iPhone and iPad'],
            ['clientsStation', 'Station'],
            ['clientsPeer', 'Peer machine']
        ]
    },
    {
        title: 'Agent actions',
        counters: [
            ['browserActions', 'Browser'],
            ['deviceActions', 'Device'],
            ['databaseActions', 'Database'],
            ['computerActions', 'Computer use']
        ]
    }
];

const PROVIDERS = [
    ['Claude', 'chatsClaude', 'turnsClaude'],
    ['Codex', 'chatsCodex', 'turnsCodex'],
    ['Gemini', 'chatsGemini', 'turnsGemini'],
    ['Copilot', 'chatsCopilot', 'turnsCopilot'],
    ['Apple', 'chatsApple', 'turnsApple']
] as const satisfies readonly (readonly [string, UsageCounter, UsageCounter])[];

const SEGMENT_LABELS: Partial<Record<Segment, Record<string, string>>> = {
    platform: { darwin: 'macOS', linux: 'Linux', win32: 'Windows', other: 'Other' },
    launcher: { service: 'Background service', desktop: 'Desktop app', standalone: 'Standalone' },
    signedIn: { '1': 'Signed in', '0': 'Not signed in' }
};

const MAX_VERSIONS = 8;
const COHORTS = 12;
const RETENTION_WEEKS = 9;

/*
 * Rows of either source for the days from `from` to `to`: the rollups for the days that can no longer
 * change, and Analytics Engine for the days it still answers fresher.
 */
export function mergeRows(rollups: readonly UsageRow[], live: readonly UsageRow[]): UsageRow[] {
    const liveDates = new Set(live.map((row) => row.date));
    return [...rollups.filter((row) => !liveDates.has(row.date)), ...live];
}

function datesBetween(from: string, to: string): string[] {
    const dates: string[] = [];
    for (let date = from; date <= to; date = addDays(date, 1)) {
        dates.push(date);
    }
    return dates;
}

/* The Monday of an ISO week. */
export function weekStart(week: string): string {
    const year = Number(week.slice(0, 4));
    const number = Number(week.slice(6));
    const january4 = new Date(Date.UTC(year, 0, 4));
    const monday = Date.UTC(year, 0, 4) - ((january4.getUTCDay() + 6) % 7) * 86_400_000;
    return addDays(new Date(monday).toISOString().slice(0, 10), (number - 1) * 7);
}

class RowIndex {
    private readonly totals = new Map<string, number>();

    constructor(rows: readonly UsageRow[]) {
        for (const row of rows) {
            const key = this.key(row.date, row.dimension, row.value, row.metric);
            this.totals.set(key, (this.totals.get(key) ?? 0) + row.total);
        }
    }

    get(date: string, metric: string, dimension = '', value = ''): number {
        return this.totals.get(this.key(date, dimension, value, metric)) ?? 0;
    }

    private key(date: string, dimension: string, value: string, metric: string): string {
        return `${date}\u0000${dimension}\u0000${value}\u0000${metric}`;
    }
}

function sumOver(dates: readonly string[], read: (date: string) => number): number {
    return dates.reduce((total, date) => total + read(date), 0);
}

function segmentShares(rows: readonly UsageRow[], segment: Segment, dates: ReadonlySet<string>, limit = Infinity): Point[] {
    const totals = new Map<string, number>();
    for (const row of rows) {
        if (row.dimension === segment && row.metric === 'active' && dates.has(row.date)) {
            totals.set(row.value, (totals.get(row.value) ?? 0) + row.total);
        }
    }
    const labels = SEGMENT_LABELS[segment] ?? {};
    const sorted = [...totals.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
    const shown = sorted.slice(0, limit).map(([value, total]) => ({ label: labels[value] ?? value, value: total }));
    const rest = sorted.slice(limit).reduce((total, [, value]) => total + value, 0);
    return rest > 0 ? [...shown, { label: 'Other', value: rest }] : shown;
}

/* Everything the page shows, from the rows of the days from `from` to `to`; `today` is the UTC day the page is drawn on. */
export function buildDashboard(rows: readonly UsageRow[], from: string, to: string, today: string): Dashboard {
    const index = new RowIndex(rows);
    const dates = datesBetween(from, to);
    const yesterday = addDays(today, -1);

    const daily: Series = { name: 'Daily active machines', points: dates.map((date) => ({ label: date, value: index.get(date, 'active') })) };

    // A week or month the range starts inside of would miss its first days, so it is left out.
    const weeks = [...new Set(dates.map(isoWeekOf))].filter((week) => weekStart(week) >= from);
    const weekly: Series = {
        name: 'Weekly active machines',
        points: weeks.map((week) => ({
            label: week,
            value: sumOver(
                dates.filter((date) => isoWeekOf(date) === week),
                (date) => index.get(date, 'firstThisWeek')
            )
        }))
    };
    const months = [...new Set(dates.map((date) => date.slice(0, 7)))].filter((month) => `${month}-01` >= from);
    const monthly: Series = {
        name: 'Monthly active machines',
        points: months.map((month) => ({
            label: month,
            value: sumOver(
                dates.filter((date) => date.startsWith(month)),
                (date) => index.get(date, 'firstThisMonth')
            )
        }))
    };

    const lastWeek = isoWeekOf(addDays(weekStart(isoWeekOf(today)), -1));
    const lastMonth = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
    const recent = (days: number) => new Set(datesBetween(addDays(today, -days), yesterday));
    const last28 = recent(28);
    const signedIn = segmentShares(rows, 'signedIn', last28);
    const signedInTotal = signedIn.reduce((total, point) => total + point.value, 0);
    const signedInShare = signedInTotal > 0 ? (signedIn.find((point) => point.label === 'Signed in')?.value ?? 0) / signedInTotal : null;

    const tiles = [
        { label: 'Daily active', value: dates.includes(yesterday) ? index.get(yesterday, 'active') : null, note: yesterday },
        { label: 'Weekly active', value: weekly.points.find((point) => point.label === lastWeek)?.value ?? null, note: `week ${lastWeek}` },
        { label: 'Monthly active', value: monthly.points.find((point) => point.label === lastMonth)?.value ?? null, note: lastMonth },
        { label: 'Signed in', value: signedInShare, note: 'share of machine-days, last 28 days' }
    ];

    const features = FEATURE_GROUPS.map((group) => ({
        title: group.title,
        items: group.counters.map(([counter, label]) => ({ label, value: sumOver(dates, (date) => index.get(date, counter)) }))
    }));

    const cohortWeeks = [...new Set(rows.filter((row) => row.dimension === 'cohortWeek').map((row) => row.value))].sort().slice(-COHORTS);
    const currentWeek = isoWeekOf(today);
    const retention = cohortWeeks.map((week): CohortRow => {
        const start = weekStart(week);
        const activeIn = (offset: number) => {
            const weekDates = datesBetween(addDays(start, offset * 7), addDays(start, offset * 7 + 6));
            return sumOver(weekDates, (date) => index.get(date, 'firstThisWeek', 'cohortWeek', week));
        };
        const size = activeIn(0);
        const shares = Array.from({ length: RETENTION_WEEKS }, (_, offset) => {
            if (isoWeekOf(addDays(start, offset * 7)) > currentWeek || size === 0) {
                return null;
            }
            return activeIn(offset) / size;
        });
        return { week, size, shares };
    });

    return {
        from,
        to,
        hasData: rows.length > 0,
        tiles,
        daily,
        weekly,
        monthly,
        versions: segmentShares(rows, 'version', recent(7), MAX_VERSIONS),
        platforms: segmentShares(rows, 'platform', last28),
        arches: segmentShares(rows, 'arch', last28),
        launchers: segmentShares(rows, 'launcher', last28),
        signedIn,
        features,
        chats: PROVIDERS.map(([label, chats]) => ({ label, value: sumOver(dates, (date) => index.get(date, chats)) })),
        turns: PROVIDERS.map(([label, , turns]) => ({ label, value: sumOver(dates, (date) => index.get(date, turns)) })),
        retention,
        startup: [
            { name: 'p50', points: dates.map((date) => ({ label: date, value: index.get(date, 'startupP50') || null })) },
            { name: 'p90', points: dates.map((date) => ({ label: date, value: index.get(date, 'startupP90') || null })) }
        ]
    };
}
