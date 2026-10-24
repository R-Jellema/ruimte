import { afterEach, beforeEach, expect, jest, test } from 'bun:test';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { streamWithTimeout } from './run.ts';
import { expectProcessTerminated } from './test-process.ts';

let root: string;
let pidFile: string;

beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-stream-timeout-')));
    pidFile = join(root, 'child.pid');
});

afterEach(async () => {
    jest.useRealTimers();
    const pid = Number.parseInt((await readFile(pidFile, 'utf8').catch(() => '')).trim(), 10);
    if (Number.isFinite(pid)) {
        try {
            process.kill(pid, 'SIGKILL');
        } catch {
            // Gone already, which is what the timeout is for.
        }
    }
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
    process.kill(pid, 0);
    jest.advanceTimersByTime(100);
    const result = await running;
    expect(result.stdout).toBe('child-ready\n');
    expect(result.code).toBe(143);
    jest.useRealTimers();
    await expectProcessTerminated(pid, 'SIGTERM');
});
