import { join } from 'node:path';
import { resolveConfig, transformWithOxc } from 'vite';

let config: ReturnType<typeof resolveConfig> | undefined;

/* Bun does not expand Vite globs. Use Vite's own transform without starting a server or watcher. */
export async function withViteGlobs(path: string, code: string): Promise<string> {
    if (!code.includes('import.meta.glob')) {
        return code;
    }
    config ??= resolveConfig({ configFile: false, root: join(import.meta.dir, '..'), logLevel: 'silent' }, 'serve');
    const resolved = await config;
    const plugin = resolved.plugins.find((candidate) => candidate.name === 'vite:import-glob');
    const hook = typeof plugin?.transform === 'function' ? plugin.transform : plugin?.transform?.handler;
    if (!hook) {
        throw new Error('Vite import-glob transform is unavailable');
    }
    const resolve = resolved.createResolver();
    // Vite removes TypeScript before import-glob parses generic type arguments.
    const source = await transformWithOxc(code, path);
    const result = (await Reflect.apply(
        hook,
        {
            resolve: async (specifier: string, importer: string) => {
                const id = await resolve(specifier, importer);
                return id === undefined ? null : { id };
            }
        },
        [source.code, path]
    )) as { code: string } | null;
    return result?.code ?? source.code;
}
