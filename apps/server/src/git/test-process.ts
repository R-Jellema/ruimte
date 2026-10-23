import { expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { constants } from 'node:os';

export function expectProcessTerminated(pid: number, signal: 'SIGTERM' | 'SIGKILL'): void {
    try {
        process.kill(pid, 0);
    } catch (error) {
        expect(error).toHaveProperty('code', 'ESRCH');
        return;
    }

    // Linux retains an orphan's PID until init reaps it, even though it has terminated.
    expect(process.platform).toBe('linux');
    let stat: string;
    try {
        stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    } catch (error) {
        expect(error).toHaveProperty('code', 'ENOENT');
        return;
    }
    const fields = stat
        .slice(stat.lastIndexOf(')') + 2)
        .trim()
        .split(/\s+/);
    expect(fields[0]).toBe('Z');
    // Fields 3 and 52 are the state and waitpid exit status, after the parenthesized name.
    expect(Number(fields[49])).toBe(constants.signals[signal]);
}
