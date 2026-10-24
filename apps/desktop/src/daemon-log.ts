import { closeSync, fstatSync, mkdirSync, openSync, readSync } from 'node:fs';
import { dirname } from 'node:path';

export interface DaemonLog {
    fd: number;
    output(): string[];
}

const MAX_BYTES = 8192;
const MAX_LINES = 10;

export function openDaemonLog(path: string): DaemonLog {
    mkdirSync(dirname(path), { recursive: true });
    const fd = openSync(path, 'a');
    const before = fstatSync(fd);
    return {
        fd,
        output() {
            let input: number | undefined;
            try {
                input = openSync(path, 'r');
                const after = fstatSync(input);
                if (after.ino !== before.ino || after.dev !== before.dev || after.size <= before.size) {
                    return [];
                }
                // Earlier launches may have logged another session's output.
                const position = Math.max(before.size, after.size - MAX_BYTES);
                const buffer = Buffer.alloc(after.size - position);
                const read = readSync(input, buffer, 0, buffer.length, position);
                const text = buffer.toString('utf8', 0, read);
                const lines = text.split(/\r?\n/);
                if (position > before.size) {
                    lines.shift();
                }
                return lines.filter((line) => line.trim() !== '').slice(-MAX_LINES);
            } catch {
                return [];
            } finally {
                if (input !== undefined) {
                    closeSync(input);
                }
            }
        }
    };
}
