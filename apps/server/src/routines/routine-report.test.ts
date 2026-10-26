import { describe, expect, test } from 'bun:test';
import type { RoutineEntry, RoutineRun } from '@ruimte/contracts';
import { REPORTED_RUNS, routineReport } from './routine-report.ts';

function run(index: number, overrides: Partial<RoutineRun> = {}): RoutineRun {
    const due = Date.UTC(2026, 9, 26 - index, 8, 0);
    return { runId: `run-${index}`, routineId: 'morning', projectId: 'p1', kind: 'scheduled', due, at: due, state: 'done', ...overrides };
}

const entry: RoutineEntry = {
    routine: {
        id: 'morning',
        title: 'Morning summary',
        kind: 'agent',
        prompt: 'Summarize what changed on main.',
        provider: 'claude',
        selection: { model: 'opus', options: {} },
        mode: 'supervised',
        perRun: 'new',
        schedule: { kind: 'weekly', days: [1, 2, 3, 4, 5], time: '09:00' },
        outputKey: 'morning'
    },
    projectId: 'p1',
    projectName: 'Ruimte',
    shared: true,
    local: {},
    digest: 'digest',
    approved: true,
    next: Date.UTC(2026, 9, 27, 8, 0),
    runs: [
        run(0, { versionNumber: 15 }),
        run(1, { state: 'skipped', skipped: 'overlap' }),
        ...Array.from({ length: REPORTED_RUNS + 2 }, (_, index) => run(index + 2))
    ],
    artifactId: 'art-1'
};

const routines = { list: async (projectId: string) => ({ routines: projectId === 'p1' ? [entry] : [], revs: {}, timeZone: 'Europe/Amsterdam' }) };

describe('a routine node read', () => {
    test('gives the definition, the newest runs and the prompt', async () => {
        const lines = (await routineReport(routines, 'p1', 'morning'))!.split('\n');
        expect(lines.slice(0, 7)).toEqual([
            'routine\tmorning\tMorning summary\tagent\tshared',
            'schedule\tweekdays 09:00\tEurope/Amsterdam',
            'approved\tyes',
            'paused\tno',
            'next\t2026-10-27T08:00:00.000Z',
            'agent\tclaude\topus\tsupervised\tnew',
            'output\tmorning\tart-1'
        ]);
        expect(lines[7]).toBe('run\trun-0\tscheduled\tdone\t2026-10-26T08:00:00.000Z\tv15\t-');
        expect(lines[8]).toBe('run\trun-1\tscheduled\tskipped:overlap\t2026-10-25T08:00:00.000Z\t-\t-');
        expect(lines.filter((line) => line.startsWith('run\t'))).toHaveLength(REPORTED_RUNS);
        expect(lines).toContain('note\t4 older runs are not printed');
        expect(lines.at(-1)).toBe('Summarize what changed on main.');
    });

    test("reads nothing of another project's routines", async () => {
        expect(await routineReport(routines, 'p2', 'morning')).toBeNull();
        expect(await routineReport(routines, 'p1', 'nightly')).toBeNull();
    });
});
