import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { waitFor, waitForAsync } from '../sessions/test-helpers.ts';
import { executeAppleCommand } from './apple-command-tool.ts';
import { processAlive } from './chat-test-helpers.ts';

let cwd: string;
beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'ruimte-apple-command-'));
});
afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
});

describe('Apple local command real process', () => {
    test('runs from the project directory with closed stdin and an explicit environment', async () => {
        const result = await executeAppleCommand(cwd, 'printf "%s|" "$APPLE_TEST"; pwd; if read value; then exit 8; fi', undefined, {
            PATH: '/bin:/usr/bin',
            APPLE_TEST: 'provided'
        });
        expect(result.failed).toBe(false);
        expect(JSON.parse(result.output).output).toContain('provided|');
        expect(JSON.parse(result.output).output).toContain(cwd.replace(/^\/var\//, '/private/var/'));
    });

    test('abort ends the shell and its waiting descendant', async () => {
        const controller = new AbortController();
        const pending = executeAppleCommand(cwd, 'sleep 60 & printf "%s" "$!" > child.pid; wait', controller.signal);
        let childPid = 0;
        try {
            await waitForAsync(async () => {
                childPid = Number(await readFile(join(cwd, 'child.pid'), 'utf8').catch(() => '0'));
                return childPid > 0;
            }, 'the child process to write its id');
            controller.abort();
            await expect(pending).rejects.toThrow();
            await waitFor(() => !processAlive(childPid), 'the child process to end');
            expect(processAlive(childPid)).toBe(false);
        } finally {
            controller.abort();
            await pending.catch(() => undefined);
            if (childPid > 0) {
                try {
                    process.kill(childPid, 'SIGKILL');
                } catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
                        // eslint-disable-next-line no-unsafe-finally -- Unexpected cleanup errors must fail the test.
                        throw error;
                    }
                }
            }
        }
    });

    test('timeout stops a real process and keeps its partial output', async () => {
        const result = await executeAppleCommand(cwd, 'printf started; sleep 60', undefined, process.env, {
            scheduleTimeout: (callback, milliseconds) => {
                expect(milliseconds).toBe(30_000);
                const timer = setTimeout(callback, 200);
                return () => clearTimeout(timer);
            }
        });
        expect(result.failed).toBe(true);
        expect(JSON.parse(result.output)).toMatchObject({ timedOut: true, output: 'started', note: 'Command stopped after 30 seconds; output is partial.' });
    });
});
