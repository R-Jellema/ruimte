import { afterEach, expect, test } from 'bun:test';
import { closeSync, mkdtempSync, renameSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDaemonLog } from './daemon-log';

const folders: string[] = [];

afterEach(() => {
    for (const folder of folders.splice(0)) {
        rmSync(folder, { recursive: true, force: true });
    }
});

function logPath(): string {
    const folder = mkdtempSync(join(tmpdir(), 'ruimte-daemon-log-'));
    folders.push(folder);
    return join(folder, 'daemon.log');
}

test('reads only this launch after the parent closes its logging descriptor', () => {
    const path = logPath();
    writeFileSync(path, 'Private output from an earlier session\n');
    const log = openDaemonLog(path);
    writeSync(log.fd, 'error while loading shared libraries: libatomic.so.1\n');
    closeSync(log.fd);

    expect(log.output()).toEqual(['error while loading shared libraries: libatomic.so.1']);
});

test('bounds a large startup log and omits an incomplete leading line', () => {
    const log = openDaemonLog(logPath());
    const lines = Array.from({ length: 20 }, (_, index) => `startup error ${index}`);
    writeSync(log.fd, `${'x'.repeat(9000)}\n${lines.join('\n')}\n`);
    closeSync(log.fd);

    expect(log.output()).toEqual(lines.slice(-10));
});

test.each(['missing', 'replaced', 'truncated'])('ignores a log that was %s after this launch', (change) => {
    const path = logPath();
    writeFileSync(path, 'Earlier output\n'.repeat(20));
    const log = openDaemonLog(path);
    closeSync(log.fd);
    if (change === 'missing') {
        rmSync(path);
    } else if (change === 'replaced') {
        renameSync(path, `${path}.old`);
        writeFileSync(path, 'Another process\n'.repeat(30));
    } else {
        writeFileSync(path, 'Another process\n');
    }

    expect(log.output()).toEqual([]);
});
