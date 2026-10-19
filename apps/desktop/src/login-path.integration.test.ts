import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { askLoginShellPath } from './login-path';

describe.skipIf(process.platform !== 'darwin')('asking the login shell for its PATH', () => {
    let zdotdir: string;
    let previous: string | undefined;

    beforeEach(async () => {
        zdotdir = await mkdtemp(join(tmpdir(), 'ruimte-login-path-'));
        previous = process.env.ZDOTDIR;
        process.env.ZDOTDIR = zdotdir;
    });

    afterEach(async () => {
        if (previous === undefined) {
            delete process.env.ZDOTDIR;
        } else {
            process.env.ZDOTDIR = previous;
        }
        await rm(zdotdir, { recursive: true, force: true });
    });

    test('answers with the PATH the profile builds', async () => {
        await writeFile(join(zdotdir, '.zshrc'), 'export PATH="/from/the/profile:$PATH"\n');
        expect(await askLoginShellPath('/bin/zsh', 'darwin')).toStartWith('/from/the/profile:');
    });

    test('does not wait on an agent the profile leaves running with the pipe open', async () => {
        await writeFile(join(zdotdir, '.zshrc'), 'export PATH="/from/the/profile:$PATH"\n(sleep 3) &!\n');
        const started = Date.now();
        expect(await askLoginShellPath('/bin/zsh', 'darwin')).toStartWith('/from/the/profile:');
        expect(Date.now() - started).toBeLessThan(2000);
    });

    test('gives up on a profile that never finishes, although the shell ignores SIGTERM', async () => {
        await writeFile(join(zdotdir, '.zshrc'), 'sleep 3\n');
        expect(await askLoginShellPath('/bin/zsh', 'darwin', 500)).toBeNull();
    });
});
