import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { BunPlugin } from 'bun';
import { COMPILER_RUNTIME, compiledByReactCompiler, REACT_COMPILED, REACT_COMPILED_PACKAGES, REACT_COMPILER_OPTIONS } from '../react-compiler';

/*
 * The React Compiler over the client and ADE CORE's React sources the way Vite hands it them
 * (`react-compiler.ts`), with the runtime behind the client's own: for the test preload and the
 * browser fixture's bundle alike.
 */

const compiler = Bun.fileURLToPath(import.meta.resolve('babel-plugin-react-compiler'));

/* The modules Vite hands the compiler (`reactCompilerPreset`): one that names no component or hook has nothing for it. */
const MAY_HOLD_REACT = /forwardRef|memo|\b(?:[A-Z]|use[A-Z0-9])/;

const compiled = new Map<string, Promise<string>>();

async function compile(path: string): Promise<string> {
    const code = await Bun.file(path).text();
    if (!compiledByReactCompiler(path) || !MAY_HOLD_REACT.test(code)) {
        return code;
    }
    // Loaded only once a test reaches a component, so a run that never does skips Babel.
    const { transformAsync } = await import('@babel/core');
    const result = await transformAsync(code, {
        filename: path,
        babelrc: false,
        configFile: false,
        sourceType: 'module',
        parserOpts: { plugins: path.endsWith('.tsx') ? ['typescript', 'jsx'] : ['typescript'] },
        plugins: [[compiler, REACT_COMPILER_OPTIONS]]
    });
    return result?.code ?? code;
}

export function compiledOnce(path: string): Promise<string> {
    let code = compiled.get(path);
    if (code === undefined) {
        code = compile(path);
        compiled.set(path, code);
    }
    return code;
}

/*
 * Compiles every module up front, for a run whose tests draw the window: the lazy views would otherwise
 * be compiled inside the first test that opens them, against its timeout.
 */
export async function compileReactSourcesAhead(): Promise<void> {
    const client = join(import.meta.dir, '..');
    const roots = [join(client, 'src'), ...REACT_COMPILED_PACKAGES.map((name) => realpathSync(join(client, 'node_modules', name, 'src')))];
    for (const root of roots) {
        for await (const file of new Bun.Glob('**/*.{ts,tsx}').scan({ cwd: root, absolute: true })) {
            if (compiledByReactCompiler(file)) {
                await compiledOnce(file);
            }
        }
    }
}

export const reactCompilerPlugin: BunPlugin = {
    name: 'react-compiler',
    setup(build) {
        build.onResolve({ filter: /^react\/compiler-runtime$/ }, (args) => (args.importer === COMPILER_RUNTIME ? undefined : { path: COMPILER_RUNTIME }));
        build.onLoad({ filter: new RegExp(REACT_COMPILED.map((pattern) => pattern.source).join('|')) }, async (args) => ({
            contents: await compiledOnce(args.path),
            loader: args.path.endsWith('.tsx') ? 'tsx' : 'ts'
        }));
    }
};
