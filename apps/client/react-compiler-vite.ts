import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Plugin, TransformResult } from 'vite';
import { CompilerPool } from './react-compiler-pool.ts';
import { MAY_HOLD_REACT } from './react-compiler.ts';

/*
 * The React Compiler for `bun dev`. Babel runs on Vite's own thread at about ten milliseconds a module,
 * which took a first start from seconds to most of a minute. Here it runs on a few worker threads, with
 * the compiler and options the build's Babel plugin has (`react-compiler-worker.ts`), and what it made is
 * kept under Vite's cache folder, one file per module, so a later start compiles only what changed.
 * A build runs the plugin as it is.
 */

interface CachedModule {
    key: string;
    code: string;
    map: TransformResult['map'];
}

type TransformHandler = (this: unknown, code: string, id: string, options?: unknown) => Promise<TransformResult | null | undefined | void>;

/* `inputs` decide the output besides a module's own text: the lockfile and the compiler's options. */
export async function compiledInDev(compiler: Promise<object>, inputs: readonly string[]): Promise<Plugin> {
    // The Babel plugin is typed against Rolldown's plugin, which Vite's extends.
    const plugin = (await compiler) as Plugin;
    const transform = plugin.transform as { handler: TransformHandler };
    const compileHere = transform.handler;
    const configResolved = plugin.configResolved;
    const version = hash(...inputs);
    const pool = new CompilerPool();
    let directory: string | null = null;

    plugin.configResolved = async function (config) {
        directory = config.command === 'serve' ? join(config.cacheDir, 'react-compiler') : null;
        if (typeof configResolved === 'function') {
            await configResolved.call(this, config);
        }
    };
    plugin.configureServer = (server) => {
        server.httpServer?.once('close', () => pool.close());
    };

    transform.handler = async function (code, id, options) {
        if (directory === null) {
            return compileHere.call(this, code, id, options);
        }
        const file = join(directory, `${hash(id)}.json`);
        const key = hash(version, code);
        const cached = await readCached(file);
        if (cached?.key === key) {
            return { code: cached.code, map: cached.map };
        }
        // The filter the preset hands the plugin, which the plugin's own hook filter does not cover.
        if (!MAY_HOLD_REACT.test(code)) {
            return null;
        }
        const compiled = await pool.compile(code, id);
        if (compiled === null) {
            return compileHere.call(this, code, id, options);
        }
        if (compiled.code === null) {
            return null;
        }
        const result = { code: compiled.code, map: compiled.map as TransformResult['map'] };
        void writeCached(directory, file, { key, ...result });
        return result;
    };

    return plugin;
}

function hash(...parts: readonly string[]): string {
    const digest = createHash('sha256');
    for (const part of parts) {
        digest.update(part).update('\0');
    }
    return digest.digest('hex');
}

async function readCached(file: string): Promise<CachedModule | null> {
    try {
        return JSON.parse(await readFile(file, 'utf8')) as CachedModule;
    } catch {
        return null;
    }
}

// Written aside and moved in, so a server that stops halfway never leaves half a module for the next start.
async function writeCached(directory: string, file: string, entry: CachedModule): Promise<void> {
    try {
        await mkdir(directory, { recursive: true });
        const aside = `${file}.${process.pid}.tmp`;
        await writeFile(aside, JSON.stringify(entry));
        await rename(aside, file);
    } catch {
        // A module that is not kept is compiled again at the next start.
    }
}
