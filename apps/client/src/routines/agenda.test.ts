import { describe, expect, test } from 'bun:test';
import { zonedTime, type RoutineEntry, type RoutineRun } from '@ruimte/contracts';
import { awaitingApproval, blocksOf, cellItems, freshRoutineId, pausedBand, weekOf } from './agenda';

const AMS = 'Europe/Amsterdam';
// Sunday 25 October 2026, 14:20 in Amsterdam: the night the clocks went back.
const NOW = zonedTime(2026, 10, 25, 14, 20, AMS);

function run(patch: Partial<RoutineRun> & Pick<RoutineRun, 'runId' | 'due' | 'state'>): RoutineRun {
    return { routineId: 'morning', projectId: 'atlas', kind: 'scheduled', at: patch.due, ...patch };
}

function entry(patch: Partial<RoutineEntry> = {}): RoutineEntry {
    return {
        routine: {
            id: 'morning',
            kind: 'agent',
            title: 'Morning summary',
            schedule: { kind: 'weekly', days: [1, 2, 3, 4, 5, 7], time: '09:00' },
            outputKey: 'morning',
            prompt: 'Summarize',
            provider: 'claude',
            mode: 'supervised',
            perRun: 'new'
        },
        projectId: 'atlas',
        projectName: 'Atlas',
        shared: false,
        local: {},
        digest: 'd1',
        approved: true,
        next: null,
        runs: [],
        ...patch
    };
}

describe('the week', () => {
    test('runs Monday to Sunday on the machine clock, with its ISO number', () => {
        const week = weekOf(NOW, AMS, 0);
        expect(week.days.map((day) => day.date)).toEqual(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
        expect(week.number).toBe(43);
        // The Sunday the clocks go back has 25 hours.
        expect(week.days[6]!.end - week.days[6]!.start).toBe(25 * 60 * 60 * 1000);
        expect(weekOf(NOW, AMS, 1).days[0]!.date).toBe('2026-10-26');
    });

    test('a block per run on the day it was due, and the times still to come', () => {
        const week = weekOf(NOW, AMS, 0);
        const monday = zonedTime(2026, 10, 19, 9, 0, AMS);
        const blocks = blocksOf(
            entry({
                runs: [
                    run({ runId: 'thu', due: zonedTime(2026, 10, 22, 9, 0, AMS), state: 'done', waited: true }),
                    run({ runId: 'wed', due: zonedTime(2026, 10, 21, 9, 0, AMS), at: zonedTime(2026, 10, 21, 9, 41, AMS), kind: 'caught-up', state: 'done' }),
                    run({ runId: 'tue', due: zonedTime(2026, 10, 20, 9, 0, AMS), state: 'limit' }),
                    run({ runId: 'fri', due: zonedTime(2026, 10, 23, 9, 0, AMS), state: 'skipped', skipped: 'overlap' }),
                    run({ runId: 'mon', due: monday, state: 'done' })
                ]
            }),
            week,
            zonedTime(2026, 10, 25, 8, 0, AMS),
            AMS
        );
        expect(blocks.map((block) => [block.day, block.look])).toEqual([
            [0, 'done'],
            [1, 'limit'],
            [2, 'caught-up'],
            [3, 'waited'],
            [4, 'skipped'],
            [6, 'next']
        ]);
    });

    test('a paused routine hatches its coming times, and one waiting for approval shows none', () => {
        const week = weekOf(NOW, AMS, 1);
        expect(blocksOf(entry({ local: { pausedAt: NOW } }), week, NOW, AMS).map((block) => block.look)).toEqual(Array(6).fill('paused'));
        expect(blocksOf(entry({ approved: false, held: 'outside' }), week, NOW, AMS)).toEqual([]);
    });

    test('a paused routine bands the rest of the week from today, past the days that hold a run', () => {
        const paused = entry({ local: { pausedAt: zonedTime(2026, 10, 13, 10, 0, AMS) } });
        const thisWeek = weekOf(NOW, AMS, 0);
        expect(pausedBand(paused, blocksOf(paused, thisWeek, NOW, AMS), thisWeek, NOW)).toEqual({ from: 6, to: 6 });
        const ranToday = entry({ ...paused, runs: [run({ runId: 'sun', due: zonedTime(2026, 10, 25, 9, 0, AMS), state: 'done' })] });
        expect(pausedBand(ranToday, blocksOf(ranToday, thisWeek, NOW, AMS), thisWeek, NOW)).toBeNull();
        const nextWeek = weekOf(NOW, AMS, 1);
        expect(pausedBand(paused, blocksOf(paused, nextWeek, NOW, AMS), nextWeek, NOW)).toEqual({ from: 0, to: 6 });
        expect(pausedBand(entry(), [], nextWeek, NOW)).toBeNull();
    });

    test('a routine said no to is no longer waiting for approval', () => {
        expect(awaitingApproval([entry({ approved: false, held: 'agent' })])).toHaveLength(1);
        expect(awaitingApproval([entry({ approved: false, held: 'agent', local: { declined: 'd1' } })])).toHaveLength(0);
    });
});

test('an id out of the title that no other routine of the project has', () => {
    expect(freshRoutineId('Morning summary of main!', new Set())).toBe('morning-summary-of-main');
    expect(freshRoutineId('Morning summary', new Set(['morning-summary']))).toBe('morning-summary-2');
    expect(freshRoutineId('…', new Set())).toBe('routine');
});

describe('a day of a repeat within a day', () => {
    const hourly = { kind: 'interval' as const, days: [7], every: 60, from: '09:00', to: '17:00' };
    const interval = (runs: RoutineRun[] = []): RoutineEntry => {
        const base = entry({ runs });
        return { ...base, routine: { ...base.routine, schedule: hourly } };
    };
    const sunday = (hour: number): number => zonedTime(2026, 10, 25, hour, 0, AMS);
    const itemsOfToday = (subject: RoutineEntry) => {
        const week = weekOf(NOW, AMS, 0);
        return cellItems(
            blocksOf(subject, week, NOW, AMS).filter((block) => block.day === 6),
            subject.routine.schedule
        );
    };

    test('folds its past runs into one chip and its coming times into another', () => {
        const runs = [9, 10, 11, 12, 13, 14].map((hour) => run({ runId: `r${hour}`, due: sunday(hour), state: hour === 11 ? 'failed' : 'done' }));
        const items = itemsOfToday(interval(runs));
        expect(items.map((item) => item.kind)).toEqual(['runs', 'coming']);
        const [folded, coming] = items;
        expect(folded!.kind === 'runs' && [folded.blocks.length, folded.failed]).toEqual([6, 1]);
        expect(coming!.kind === 'coming' && coming.every !== null && [coming.blocks.map((block) => block.at), coming.every, coming.to]).toEqual([
            [15, 16, 17].map(sunday),
            60,
            '17:00'
        ]);
    });

    test('a cron folds its coming times the same way, without a step', () => {
        const base = entry();
        const subject = { ...base, routine: { ...base.routine, schedule: { kind: 'cron' as const, expression: '0 9,15,16,17 * * *' } } };
        const items = itemsOfToday(subject);
        expect(items.map((item) => item.kind)).toEqual(['coming']);
        expect(items[0]!.kind === 'coming' && [items[0]!.blocks.map((block) => block.at), items[0]!.every]).toEqual([[15, 16, 17].map(sunday), null]);
    });

    test('keeps a run that needs a person or still goes on as a block of its own', () => {
        const runs = [9, 10, 11, 12, 13].map((hour) => run({ runId: `r${hour}`, due: sunday(hour), state: 'done' }));
        runs.push(run({ runId: 'r14', due: sunday(14), state: 'needs-you' }));
        const items = itemsOfToday(interval(runs));
        expect(items.map((item) => (item.kind === 'block' ? item.block.look : item.kind))).toEqual(['runs', 'waiting', 'coming']);
    });

    test('shows up to two runs and a last coming time as blocks', () => {
        const late = { ...hourly, from: '13:00', to: '15:00' };
        const subject = interval([run({ runId: 'r13', due: sunday(13), state: 'done' }), run({ runId: 'r14', due: sunday(14), state: 'done' })]);
        const items = itemsOfToday({ ...subject, routine: { ...subject.routine, schedule: late } });
        expect(items.map((item) => (item.kind === 'block' ? item.block.look : item.kind))).toEqual(['done', 'done', 'next']);
    });

    test('a weekly routine run by hand many times keeps its coming time a block', () => {
        const runs = [9, 10, 11].map((hour) => run({ runId: `m${hour}`, due: sunday(hour), state: 'done', kind: 'manual' }));
        const subject = entry({ runs, routine: { ...entry().routine, schedule: { kind: 'weekly', days: [7], time: '18:00' } } });
        expect(itemsOfToday(subject).map((item) => (item.kind === 'block' ? item.block.look : item.kind))).toEqual(['runs', 'next']);
    });
});
