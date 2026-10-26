import { beforeEach, describe, expect, test } from 'bun:test';
import { narrowerMode } from '@adecore/agents/providers';
import type { Routine, RoutineEntry, RoutineMadeBy, RoutineRunNowResult, RuntimeMode } from '@ruimte/contracts';
import { refusalBody } from '@adecore/agents/context';
import { agentRoutines } from '../routines/agent-host.ts';
import type { Routines } from '../routines/routines.ts';
import { parseSchedule, scheduleText } from './routine-verb.ts';
import { VerbRefusal, type CanvasHost, type LaunchReading, type Noun } from './verb.ts';
import { verbNamed } from './verbs.ts';

const noun = verbNamed('routine') as Noun;

interface Saved {
    routine: Routine;
    ceiling: RuntimeMode;
    madeBy: RoutineMadeBy;
    shared: boolean;
}

let entries: RoutineEntry[];
let saves: Saved[];
let calls: string[];
let runOutcome: RoutineRunNowResult;
let callerMode: RuntimeMode;
let host: CanvasHost;

function entry(routine: Routine, overrides: Partial<RoutineEntry> = {}): RoutineEntry {
    return {
        routine,
        projectId: 'p1',
        projectName: 'Ruimte',
        shared: false,
        local: {},
        digest: 'digest',
        approved: true,
        next: Date.UTC(2026, 9, 27, 8, 0),
        runs: [],
        ...overrides
    };
}

const report: Routine = {
    id: 'weekly-report',
    title: 'Weekly report',
    kind: 'agent',
    prompt: 'Summarize the week.',
    provider: 'claude',
    mode: 'supervised',
    perRun: 'new',
    schedule: { kind: 'weekly', days: [1, 2, 3, 4, 5], time: '09:00' },
    outputKey: 'weekly-report'
};

const cleanup: Routine = {
    id: 'cleanup',
    title: 'Cleanup',
    kind: 'command',
    command: 'bun run clean',
    schedule: { kind: 'once', date: '2026-10-27', time: '22:00' },
    outputKey: 'cleanup'
};

/* The part of `Routines` the verbs reach, with `saveByAgent` doing what the real one does to a mode and a file. */
function fakeRoutines(): Pick<Routines, 'list' | 'saveByAgent' | 'pause' | 'resume' | 'runNow'> {
    return {
        list: async () => ({ routines: entries, revs: { p1: 3 }, timeZone: 'Europe/Amsterdam' }),
        saveByAgent: async (_projectId, routine, ceiling, madeBy, shared = false) => {
            const bounded = routine.kind === 'agent' ? { ...routine, mode: narrowerMode(routine.mode, ceiling) } : routine;
            const existing = entries.find((candidate) => candidate.routine.id === routine.id);
            const placed = existing?.shared ?? shared;
            saves.push({ routine: bounded, ceiling, madeBy, shared: placed });
            return { routine: bounded, rev: 4, shared: placed };
        },
        pause: async (_projectId, routineId) => {
            calls.push(`pause ${routineId}`);
        },
        resume: async (_projectId, routineId) => {
            calls.push(`resume ${routineId}`);
        },
        runNow: async (_projectId, routineId) => {
            calls.push(`run ${routineId}`);
            return runOutcome;
        }
    };
}

const launches: LaunchReading[] = [{ launchId: 'dev', name: 'Dev server', kind: 'service', approved: true, url: null, port: null, members: [], status: null }];

beforeEach(() => {
    entries = [
        entry(report, { runs: [{ runId: 'run-1', routineId: 'weekly-report', projectId: 'p1', kind: 'scheduled', due: 0, at: 0, state: 'done' }] }),
        entry(cleanup, { approved: false, held: 'agent', shared: true, local: { pausedAt: 5 }, next: null })
    ];
    saves = [];
    calls = [];
    runOutcome = { outcome: 'started', runId: 'run-2' };
    callerMode = 'auto-accept-edits';
    host = {
        projects: { locate: (id: string) => (id === 'chat-1' ? { projectId: 'p1', folder: '/tmp/p1', canvasId: 'main' } : null) },
        starts: {
            modeOf: () => callerMode,
            accountOf: () => ({ kind: 'claude' }),
            installedAgents: async () => ['claude', 'codex'],
            preferredSelection: () => undefined
        },
        launches: { list: async () => launches },
        routines: agentRoutines(
            fakeRoutines(),
            (id) => (id === 'chat-1' ? 'Planner' : null),
            () => 1_000
        )
    } as unknown as CanvasHost;
});

async function run(argv: string[]): Promise<string[]> {
    try {
        return await noun.run(argv, { caller: 'chat-1', host });
    } catch (error) {
        if (error instanceof VerbRefusal) {
            return refusalBody(error.code, error.message, error.lines).split('\n');
        }
        throw error;
    }
}

describe('the schedule --at takes', () => {
    test('reads sets of days, single days and one time, and writes each back the same way', () => {
        for (const text of ['daily 23:00', 'weekdays 09:00', 'weekends 10:30', 'mon,thu 17:00', 'once 2026-10-27 22:00']) {
            expect(scheduleText(parseSchedule(text)!)).toBe(text);
        }
        expect(parseSchedule('Thursday,Mon 7:05')).toEqual({ kind: 'weekly', days: [1, 4], time: '07:05' });
    });

    test('refuses a time past the clock, a day that is none and a date that does not exist', () => {
        for (const text of ['daily 24:00', 'someday 09:00', 'once 2026-02-30 09:00', 'weekdays', 'once 2026-10-27']) {
            expect(parseSchedule(text)).toBeNull();
        }
    });

    test('reads a repeat within a day and writes it back the same way', () => {
        for (const text of ['weekdays every 1h 09:00-17:00', 'daily every 30m 08:00-18:00', 'mon,wed every 2h 10:00-16:00', 'sat every 45m 07:15-12:00']) {
            expect(scheduleText(parseSchedule(text)!)).toBe(text);
        }
        expect(parseSchedule('weekdays every 1h 09:00-17:00')).toEqual({ kind: 'interval', days: [1, 2, 3, 4, 5], every: 60, from: '09:00', to: '17:00' });
        expect(scheduleText(parseSchedule('Tue every 60m 8:00-9:00')!)).toBe('tue every 1h 08:00-09:00');
    });

    test('refuses a repeat off the quarter hours, past half a day or with its end before its start', () => {
        for (const text of [
            'daily every 20m 09:00-17:00',
            'daily every 13h 00:00-23:00',
            'daily every 0m 09:00-17:00',
            'daily every 1h 17:00-09:00',
            'daily every 1h 09:00',
            'daily every 1x 09:00-17:00'
        ]) {
            expect(parseSchedule(text)).toBeNull();
        }
    });
});

describe('ruimte-context routine', () => {
    test('lists every routine with its schedule, approval, pause, next time and last run', async () => {
        expect(await run(['list'])).toEqual([
            'weekly-report\tWeekly report\tagent\tweekdays 09:00\tyes\tno\t2026-10-27T08:00:00.000Z\tdone',
            'cleanup\tCleanup\tcommand\tonce 2026-10-27 22:00\theld\tyes\t-\t-',
            'timezone\tEurope/Amsterdam'
        ]);
    });

    test('a new routine runs an agent of the caller in supervised, in the private file, and waits for a person', async () => {
        const lines = await run(['new', '--title', 'Nightly digest', '--at', 'daily 23:00', '--prompt', 'Digest the day.']);
        expect(lines[0]).toBe('saved\tnightly-digest\tNightly digest\tagent\tsupervised\tprivate');
        expect(lines[1]).toStartWith('held\t');
        expect(saves).toEqual([
            {
                routine: {
                    id: 'nightly-digest',
                    title: 'Nightly digest',
                    schedule: { kind: 'weekly', days: [1, 2, 3, 4, 5, 6, 7], time: '23:00' },
                    outputKey: 'nightly-digest',
                    kind: 'agent',
                    prompt: 'Digest the day.',
                    provider: 'claude',
                    mode: 'supervised',
                    perRun: 'new'
                },
                ceiling: 'auto-accept-edits',
                madeBy: { chatId: 'chat-1', title: 'Planner', at: 1_000 },
                shared: false
            }
        ]);
    });

    test('an id that is taken gets a number, and --shared puts a new routine in the shared file', async () => {
        await run(['new', '--title', 'Weekly report', '--at', 'mon 09:00', '--prompt', 'Again.', '--shared']);
        expect(saves[0]!.routine.id).toBe('weekly-report-2');
        expect(saves[0]!.shared).toBe(true);
    });

    test('a mode wider than the caller is narrowed to it, and says so', async () => {
        const lines = await run(['new', '--title', 'Fixer', '--at', 'daily 08:00', '--prompt', 'Fix.', '--mode', 'full-access']);
        expect(lines[0]).toBe('saved\tfixer\tFixer\tagent\tauto-accept-edits\tprivate');
        expect(lines[2]).toBe('note\t--mode full-access is wider than your own, so it runs in auto-accept-edits');
    });

    test('a command routine keeps its folder relative and inside the project', async () => {
        await run(['new', '--title', 'Build', '--at', 'weekdays 18:00', '--kind', 'command', '--command', 'bun run build', '--cwd', '/tmp/p1/apps/site']);
        expect(saves[0]!.routine).toMatchObject({ kind: 'command', command: 'bun run build', cwd: 'apps/site' });
        expect((await run(['new', '--title', 'Out', '--at', 'daily 01:00', '--kind', 'command', '--command', 'ls', '--cwd', '../other']))[0]).toStartWith(
            'refused\tcwd-outside-project\t'
        );
    });

    test('a launch routine names the launch by its id, and a field of another kind is refused', async () => {
        await run(['new', '--title', 'Morning dev', '--at', 'weekdays 08:30', '--kind', 'launch', '--launch', 'Dev server']);
        expect(saves[0]!.routine).toMatchObject({ kind: 'launch', launchId: 'dev' });
        expect((await run(['new', '--title', 'Mixed', '--at', 'daily 08:30', '--kind', 'launch', '--launch', 'dev', '--prompt', 'Hi']))[0]).toStartWith(
            'refused\twrong-kind\t--prompt is for a routine of kind agent'
        );
    });

    test('an agent routine without a prompt and a schedule it cannot read are refused before anything is saved', async () => {
        expect((await run(['new', '--title', 'Empty', '--at', 'daily 08:30']))[0]).toStartWith('refused\tprompt-required\t');
        expect((await run(['new', '--title', 'Never', '--at', 'sometimes', '--prompt', 'Hi']))[0]).toContain('--at takes');
        expect(saves).toEqual([]);
    });

    test('an edit keeps what it leaves out and the file the routine is in, and asks the person again', async () => {
        const lines = await run(['edit', 'cleanup', '--at', 'weekends 03:00']);
        expect(lines[0]).toBe('saved\tcleanup\tCleanup\tcommand\t-\tshared');
        expect(saves[0]!.routine).toEqual({ ...cleanup, schedule: { kind: 'weekly', days: [6, 7], time: '03:00' } });
        expect((await run(['edit', 'gone', '--title', 'X']))[0]).toBe('refused\troutine-not-found\tThis project has no routine gone');
    });

    test('pause and resume reach the routine; run starts only one a person approved and whose last run ended', async () => {
        expect(await run(['pause', 'weekly-report'])).toEqual(['paused\tweekly-report\tWeekly report']);
        expect(await run(['resume', 'weekly-report'])).toEqual(['resumed\tweekly-report\tWeekly report']);
        expect(await run(['run', 'weekly-report'])).toEqual(['started\tweekly-report\tWeekly report\trun-2']);
        runOutcome = { outcome: 'held' };
        expect((await run(['run', 'cleanup']))[0]).toStartWith('refused\troutine-held\t');
        runOutcome = { outcome: 'busy' };
        expect((await run(['run', 'weekly-report']))[0]).toStartWith('refused\troutine-busy\t');
        expect(calls).toEqual(['pause weekly-report', 'resume weekly-report', 'run weekly-report', 'run cleanup', 'run weekly-report']);
    });

    test('there is no verb that approves a routine', async () => {
        expect((await run(['approve', 'cleanup']))[0]).toStartWith('refused\t');
    });
});
