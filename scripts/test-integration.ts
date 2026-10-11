import { Glob } from 'bun';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function integrationFiles(root: string, browser = false): string[] {
    const pattern = browser ? '*.browser.integration.test.ts' : '*.integration.test.ts';
    return [...new Glob(`{apps,packages,scripts}/**/${pattern}`).scanSync({ cwd: root, onlyFiles: true, followSymlinks: false })]
        .filter((path) => !path.split('/').includes('node_modules') && (browser || !path.endsWith('.browser.integration.test.ts')))
        .sort()
        .map((path) => `./${path}`);
}

async function main(): Promise<void> {
    const fixtureRoot = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-integration-')));
    try {
        const files = process.argv.slice(2);
        const browser = files[0] === '--browser';
        if (browser) {
            files.shift();
        }
        const config = browser ? 'browser.bunfig.toml' : 'integration.bunfig.toml';
        const selected = files.length > 0 ? files : integrationFiles(process.cwd(), browser);
        if (selected.length === 0) {
            throw new Error('No integration tests found in apps, packages or scripts.');
        }
        const child = Bun.spawn([process.execPath, `--config=${config}`, 'test', '--conditions=source', ...selected], {
            env: { ...process.env, RUIMTE_INTEGRATION_FIXTURE_ROOT: fixtureRoot },
            stdin: 'inherit',
            stdout: 'inherit',
            stderr: 'inherit'
        });
        const interrupt = () => child.kill('SIGINT');
        const terminate = () => child.kill('SIGTERM');
        process.once('SIGINT', interrupt);
        process.once('SIGTERM', terminate);
        try {
            process.exitCode = await child.exited;
        } finally {
            process.off('SIGINT', interrupt);
            process.off('SIGTERM', terminate);
        }
    } finally {
        await rm(fixtureRoot, { recursive: true, force: true });
        console.log('Integration fixtures removed.');
    }
}

if (import.meta.main) {
    await main();
}
