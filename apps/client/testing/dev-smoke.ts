import { expect } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type InlineConfig, type ViteDevServer } from 'vite';

const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export const smokeBrowser = existsSync(MAC_CHROME) ? MAC_CHROME : (Bun.which('google-chrome') ?? Bun.which('chromium') ?? Bun.which('chromium-browser'));
export const smokeNode = Bun.which('node');

/* The client's own dev server on a free port with a cache of its own, for as long as `run` takes. */
export async function withDevServer(config: InlineConfig, run: (server: ViteDevServer, url: string) => Promise<void>): Promise<void> {
    const temporary = await mkdtemp(join(tmpdir(), 'ruimte-dev-smoke-'));
    const server = await createServer({
        root: fileURLToPath(new URL('..', import.meta.url)),
        configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
        cacheDir: join(temporary, 'cache'),
        logLevel: 'silent',
        ...config,
        server: { port: 0, warmup: { clientFiles: [] } }
    });
    try {
        await server.listen();
        const address = server.httpServer?.address();
        if (address === null || address === undefined || typeof address === 'string') {
            throw new Error('Vite did not bind a TCP port');
        }
        await run(server, `http://localhost:${address.port}`);
    } finally {
        await server.close();
        await rm(temporary, { recursive: true, force: true });
    }
}

/* Runs one probe of `dev-import-smoke.mjs` in a headless browser against the dev server, and answers what it found. */
export async function runSmoke(url: string, probe: 'editor-labels' | 'image-save'): Promise<Record<string, unknown>> {
    const process = Bun.spawn([smokeNode!, fileURLToPath(new URL('./dev-import-smoke.mjs', import.meta.url)), url, smokeBrowser!, probe], {
        stdout: 'pipe',
        stderr: 'pipe'
    });
    const [output, errors, exitCode] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
    expect(exitCode, `${output}\n${errors}`).toBe(0);
    return JSON.parse(output).probe;
}
