import { describe, expect, test } from 'bun:test';
import { zonedTime, type RoutineEntry, type RoutineRun } from '@ruimte/contracts';
import { awaitingApproval, blocksOf, freshRoutineId, scheduleForDays, weekOf } from './agenda';

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

    test('a routine said no to is no longer waiting for approval', () => {
        expect(awaitingApproval([entry({ approved: false, held: 'agent' })])).toHaveLength(1);
        expect(awaitingApproval([entry({ approved: false, held: 'agent', local: { declined: 'd1' } })])).toHaveLength(0);
    });
});

describe('a drag across the days', () => {
    test('one day is that date once, more are those weekdays', () => {
        const week = weekOf(NOW, AMS, 0);
        expect(scheduleForDays(week, 2, 2, '09:00')).toEqual({ kind: 'once', date: '2026-10-21', time: '09:00' });
        expect(scheduleForDays(week, 4, 0, '09:00')).toEqual({ kind: 'weekly', days: [1, 2, 3, 4, 5], time: '09:00' });
    });
});

test('an id out of the title that no other routine of the project has', () => {
    expect(freshRoutineId('Morning summary of main!', new Set())).toBe('morning-summary-of-main');
    expect(freshRoutineId('Morning summary', new Set(['morning-summary']))).toBe('morning-summary-2');
    expect(freshRoutineId('…', new Set())).toBe('routine');
});
