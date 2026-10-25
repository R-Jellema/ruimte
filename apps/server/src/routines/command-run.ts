import { spawn } from 'node:child_process';
import type { CommandResult } from './routines.ts';

/*
 * Runs a routine's command in the person's login shell and keeps what it printed, up to the cap; the
 * rest is cut with a line that says so. Never stopped on a clock: a stuck command keeps its routine
 * busy, so its next run is skipped and says why.
 */
export function runCommand(cwd: string, command: string, capBytes: number): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
        const shell = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : (process.env.SHELL ?? '/bin/sh');
        const args = process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-lc', command];
        const child = spawn(shell, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
        const pieces: Buffer[] = [];
        let size = 0;
        let cut = false;
        const take = (chunk: Buffer): void => {
            if (size >= capBytes) {
                cut = true;
                return;
            }
            const room = capBytes - size;
            pieces.push(chunk.byteLength > room ? chunk.subarray(0, room) : chunk);
            size += Math.min(room, chunk.byteLength);
            cut ||= chunk.byteLength > room;
        };
        child.stdout.on('data', take);
        child.stderr.on('data', take);
        child.on('error', reject);
        child.on('close', (code, signal) => {
            if (cut) {
                pieces.push(Buffer.from(`\n[Output cut at ${capBytes} bytes]\n`));
            }
            resolve({ exitCode: code ?? (signal === null ? 1 : 128), output: new Uint8Array(Buffer.concat(pieces)) });
        });
    });
}
