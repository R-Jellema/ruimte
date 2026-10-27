import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileDedupeStore } from '@ruimte/telemetry/file-store';
import {
    daemonBeforeSend,
    dedupeStorePath,
    helperExitReportable,
    helperStderrOf,
    markInApp,
    sendFatal,
    StderrTail,
    telemetryBuild,
    telemetrySettings,
    type FatalTimer,
    type TelemetrySettings
} from './reporter.ts';

describe('telemetryBuild', () => {
    test('is off outside a compiled release, so tests and dev send nothing', () => {
        expect(telemetryBuild()).toBe(false);
        expect(telemetrySettings('service', '/tmp/home')).toBeNull();
    });
});

describe('markInApp', () => {
    test('counts the source of the daemon as its own and the dependencies not', () => {
        const event = {
            exception: {
                values: [{ stacktrace: { frames: [{ filename: '../../node_modules/.bun/zod/index.js' }, { filename: 'src/daemon.ts', in_app: false }] } }]
            }
        };
        const frames = markInApp(event).exception.values[0]!.stacktrace.frames;
        expect(frames.map((frame) => (frame as { in_app?: boolean }).in_app)).toEqual([false, true]);
    });
});

describe('daemonBeforeSend', () => {
    test('scrubs and lets the same error out once a day, remembered under the home', () => {
        const home = mkdtempSync(join(tmpdir(), 'ruimte-telemetry-'));
        try {
            const settings: TelemetrySettings = {
                dsn: 'https://key@example.invalid/1',
                release: 'ruimte@0.0.0',
                tags: {},
                home: '/Users/jane',
                username: 'jane',
                hostname: 'janes-mac',
                ruimteHome: home
            };
            const beforeSend = daemonBeforeSend(settings, () => ['acme-portal']);
            const event = () => ({ message: 'opening acme-portal in /Users/jane/work/acme failed', tags: { helper: 'database', project: 'x' } });
            expect(beforeSend<object>(event())).toEqual({ message: 'opening <redacted> in <path> failed', tags: { helper: 'database' } });
            expect(beforeSend(event())).toBeNull();
            expect(Object.keys(JSON.parse(readFileSync(dedupeStorePath(home), 'utf8')))).toHaveLength(1);
        } finally {
            rmSync(home, { recursive: true, force: true });
        }
    });

    test('leaves a missing store to the dedupe, which reads it as empty', () => {
        expect(() => fileDedupeStore('/nonexistent/sent.json').read()).toThrow();
    });
});

describe('helperStderrOf', () => {
    test('keeps the last lines and blanks what a helper quoted', () => {
        const lines = [...Array.from({ length: 30 }, (_value, i) => `line ${i}`), "panicked at 'unexpected token `customerName`'"];
        const stderr = helperStderrOf(lines);
        expect(stderr.at(-1)).toBe("panicked at '<text>'");
        expect(stderr.length).toBeLessThan(lines.length);
    });
});

describe('StderrTail', () => {
    test('keeps the last lines without the empty ones', () => {
        const tail = new StderrTail(2);
        tail.push('one\n\ntwo\r\nthree');
        expect(tail.get()).toEqual(['two', 'three']);
    });
});

describe('sendFatal', () => {
    /* A clock that moves only when the fatal path waits. */
    function fakeTimer(): FatalTimer & { at: number } {
        const timer = {
            at: 0,
            now: () => timer.at,
            wait: async (ms: number) => {
                timer.at += ms;
            }
        };
        return timer;
    }

    test('does not wait on a registry that never answers, and gives the flush what is left of two seconds', async () => {
        const timer = fakeTimer();
        const steps: string[] = [];
        await sendFatal(
            () => new Promise<void>(() => undefined),
            () => steps.push('capture'),
            async (ms) => {
                steps.push(`flush ${ms}`);
            },
            timer
        );
        expect(steps).toEqual(['capture', 'flush 1500']);
    });

    test('captures after a registry that answers, with the redactions it read', async () => {
        const timer = fakeTimer();
        const steps: string[] = [];
        await sendFatal(
            async () => {
                steps.push('refresh');
            },
            () => steps.push('capture'),
            async (ms) => {
                steps.push(`flush ${ms <= 2000}`);
            },
            timer
        );
        expect(steps).toEqual(['refresh', 'capture', 'flush true']);
    });
});

describe('helperExitReportable', () => {
    test('reports a crash, but not a stop a person or a service manager sent, nor anything while the daemon stops', () => {
        expect(helperExitReportable({ helper: 'database', code: 1 }, false)).toBe(true);
        expect(helperExitReportable({ helper: 'language-server', code: null, signal: 'SIGSEGV' }, false)).toBe(true);
        for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
            expect(helperExitReportable({ helper: 'language-server', code: null, signal }, false)).toBe(false);
        }
        expect(helperExitReportable({ helper: 'database', code: 1 }, true)).toBe(false);
    });
});
