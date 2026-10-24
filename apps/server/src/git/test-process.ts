import { expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { constants } from 'node:os';
import { waitFor } from '../sessions/test-helpers.ts';

export async function expectProcessTerminated(pid: number, signal: 'SIGTERM' | 'SIGKILL'): Promise<void> {
    await waitFor(() => {
        try {
            process.kill(pid, 0);
        } catch (error) {
            expect(error).toHaveProperty('code', 'ESRCH');
            return true;
        }

        if (process.platform !== 'linux') {
            return false;
        }
        // Linux retains an orphan's PID until init reaps it, even though it has terminated.
        let stat: string;
        try {
            stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
        } catch (error) {
            // Reaping between procfs lookup and read yields ESRCH instead of ENOENT.
            expect(['ENOENT', 'ESRCH']).toContain((error as NodeJS.ErrnoException).code ?? '');
            return true;
        }
        const fields = stat
            .slice(stat.lastIndexOf(')') + 2)
            .trim()
            .split(/\s+/);
        if (fields[0] !== 'Z') {
            return false;
        }
        // Fields 3 and 52 are the state and waitpid exit status, after the parenthesized name.
        expect(Number(fields[49])).toBe(constants.signals[signal]);
        return true;
    }, `process ${pid} to terminate`);
}
