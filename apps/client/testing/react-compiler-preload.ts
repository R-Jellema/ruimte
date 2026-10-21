import { COMPILER_RUNTIME, compiledByReactCompiler, REACT_COMPILED, REACT_COMPILER_OPTIONS } from '../react-compiler';

/*
 * A test runs the client and ADE CORE's React sources the way the app ships them: through the React
 * Compiler (`react-compiler.ts`), with the runtime behind the client's own. It goes before every
 * preload that loads a component.
 */

const compiler = Bun.fileURLToPath(import.meta.resolve('babel-plugin-react-compiler'));

/* The modules Vite hands the compiler (`reactCompilerPreset`): one that names no component or hook has nothing for it. */
const MAY_HOLD_REACT = /forwardRef|memo|\b(?:[A-Z]|use[A-Z0-9])/;

Bun.plugin({
    name: 'react-compiler',
    setup(build) {
        build.onResolve({ filter: /^react\/compiler-runtime$/ }, (args) => (args.importer === COMPILER_RUNTIME ? undefined : { path: COMPILER_RUNTIME }));
        build.onLoad({ filter: new RegExp(REACT_COMPILED.map((pattern) => pattern.source).join('|')) }, async (args) => {
            const code = await Bun.file(args.path).text();
            const loader = args.path.endsWith('.tsx') ? 'tsx' : 'ts';
            if (!compiledByReactCompiler(args.path) || !MAY_HOLD_REACT.test(code)) {
                return { contents: code, loader };
            }
            // Loaded only once a test reaches a component, so a run that never does skips Babel.
            const { transformAsync } = await import('@babel/core');
            const result = await transformAsync(code, {
                filename: args.path,
                babelrc: false,
                configFile: false,
                sourceType: 'module',
                parserOpts: { plugins: loader === 'tsx' ? ['typescript', 'jsx'] : ['typescript'] },
                plugins: [[compiler, REACT_COMPILER_OPTIONS]]
            });
            return { contents: result?.code ?? code, loader };
        });
    }
});
