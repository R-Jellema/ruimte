import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    daemonBeforeSend,
    dedupeStorePath,
    fileDedupeStore,
    markInApp,
    StderrTail,
    telemetryBuild,
    telemetrySettings,
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

describe('StderrTail', () => {
    test('keeps the last lines without the empty ones', () => {
        const tail = new StderrTail(2);
        tail.push('one\n\ntwo\r\nthree');
        expect(tail.get()).toEqual(['two', 'three']);
    });
});
