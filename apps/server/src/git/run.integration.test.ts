import { afterEach, beforeEach, expect, jest, test } from 'bun:test';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { streamWithTimeout } from './run.ts';
import { expectProcessTerminated, killFromPidFile } from './test-process.ts';
import { processAlive } from '../process-test-helpers.ts';

let root: string;
let pidFile: string;

beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-stream-timeout-')));
    pidFile = join(root, 'child.pid');
});

afterEach(async () => {
    jest.useRealTimers();
    await killFromPidFile(pidFile);
    await rm(root, { recursive: true, force: true });
});

test('a timeout ends the children that keep the output open, not only the command', async () => {
    // The background sleep inherits stdout, the way an MCP server a CLI started does.
    const script = `sleep 30 & echo child-ready; echo $! > '${pidFile}'; wait`;
    jest.useFakeTimers();
    const running = streamWithTimeout('sh', ['-c', script], root, 100);
    let pid = NaN;
    while (!Number.isSafeInteger(pid)) {
        pid = Number.parseInt(await readFile(pidFile, 'utf8').catch(() => ''), 10);
    }
    expect(processAlive(pid)).toBe(true);
    jest.advanceTimersByTime(100);
    const result = await running;
    expect(result.stdout).toBe('child-ready\n');
    expect(result.code).toBe(143);
    jest.useRealTimers();
    await expectProcessTerminated(pid, 'SIGTERM');
});
