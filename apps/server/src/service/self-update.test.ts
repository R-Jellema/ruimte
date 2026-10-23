import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SelfUpdater, buildFileOf, readBuildFile, type SelfUpdateTimers, type SelfUpdaterOptions } from './self-update.ts';

describe('the build file', () => {
    test('sits beside the binary', () => {
        expect(buildFileOf('/Applications/Ruimte.app/Contents/Resources/bin/ruimte')).toBe(
            join('/Applications/Ruimte.app/Contents/Resources/bin', 'ruimte.build')
        );
    });

    test('is read trimmed, and a missing or empty one is null', () => {
        const directory = mkdtempSync(join(tmpdir(), 'ruimte-build-'));
        const path = join(directory, 'ruimte.build');
        try {
            writeFileSync(path, 'build-b\n');
            expect(readBuildFile(path)).toBe('build-b');
            writeFileSync(path, '\n');
            expect(readBuildFile(path)).toBeNull();
            rmSync(path);
            expect(readBuildFile(path)).toBeNull();
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });
});

function manualTimers() {
    const intervals: Array<() => void> = [];
    const pending: Array<() => void> = [];
    const timers: SelfUpdateTimers = {
        every: (_ms, run) => {
            intervals.push(run);
            return () => intervals.splice(intervals.indexOf(run), 1);
        },
        after: (_ms, run) => {
            pending.push(run);
            return () => pending.splice(pending.indexOf(run), 1);
        }
    };
    return { timers, intervals, pending };
}

function updater(overrides: Partial<SelfUpdaterOptions> = {}) {
    const state = { onDisk: 'build-a' as string | null, idle: false, idleScans: 0, exits: 0, logs: [] as string[] };
    const clock = manualTimers();
    const instance = new SelfUpdater({
        underService: true,
        running: 'build-a',
        readOnDisk: () => state.onDisk,
        idle: () => {
            state.idleScans += 1;
            return state.idle;
        },
        exit: () => {
            state.exits += 1;
        },
        log: (line) => state.logs.push(line),
        timers: clock.timers,
        ...overrides
    });
    return { instance, state, clock };
}

describe('SelfUpdater', () => {
    test('exits once when a newer build is on disk and the machine is idle', () => {
        const { instance, state, clock } = updater();
        state.idle = true;
        instance.start();
        clock.intervals[0]!();
        expect(state.exits).toBe(0);
        expect(state.logs).toEqual([]);
        expect(state.idleScans).toBe(0);
        state.onDisk = 'build-b';
        clock.intervals[0]?.();
        expect(state.exits).toBe(1);
        expect(state.idleScans).toBe(1);
        expect(clock.intervals).toHaveLength(0);
        instance.check();
        expect(state.exits).toBe(1);
    });

    test('waits while busy, logs that once, and goes when a nudge finds it idle', () => {
        const { instance, state, clock } = updater();
        instance.start();
        state.onDisk = 'build-b';
        clock.intervals[0]!();
        clock.intervals[0]!();
        expect(state.exits).toBe(0);
        expect(state.logs).toEqual(['A newer build is on disk; updating once no terminal or agent is running']);
        state.idle = true;
        instance.nudge();
        instance.nudge();
        expect(clock.pending).toHaveLength(1);
        clock.pending[0]!();
        expect(state.exits).toBe(1);
        expect(state.logs).toEqual([
            'A newer build is on disk; updating once no terminal or agent is running',
            'A newer build is on disk and nothing is running; exiting so the service starts it'
        ]);
    });

    test('waits without scanning work when the build id is unreadable, then recovers', () => {
        const { instance, state, clock } = updater();
        state.onDisk = null;
        state.idle = true;
        instance.start();
        clock.intervals[0]!();
        expect(state.exits).toBe(0);
        clock.intervals[0]!();
        expect(state.exits).toBe(0);
        expect(state.idleScans).toBe(0);
        expect(state.logs).toEqual(['A build id beside the binary cannot be read; waiting before updating']);
        state.onDisk = 'build-b';
        clock.intervals[0]!();
        expect(state.exits).toBe(1);
        expect(state.idleScans).toBe(1);
        expect(clock.intervals).toHaveLength(0);
    });

    test.each([
        ['outside the service', { underService: false }],
        ['without a running build id', { running: null }]
    ] as const)('does not start %s', (_label, options) => {
        const { instance, clock } = updater(options);
        instance.start();
        instance.nudge();
        expect(clock.intervals).toHaveLength(0);
        expect(clock.pending).toHaveLength(0);
    });

    test.each([
        ['outside the service', { underService: false }],
        ['without a running build id', { running: null }]
    ] as const)('does not exit %s even when asked directly', (_label, options) => {
        const { instance, state } = updater(options);
        state.onDisk = 'build-b';
        state.idle = true;
        expect(instance.check()).toBe('off');
        expect(state.exits).toBe(0);
        expect(state.logs).toEqual([]);
        expect(state.idleScans).toBe(0);
    });
});
