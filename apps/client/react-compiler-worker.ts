import { fileURLToPath } from 'node:url';
import { parentPort } from 'node:worker_threads';
import { transformAsync } from '@babel/core';
import { REACT_COMPILER_OPTIONS } from './react-compiler.ts';

/*
 * One thread of `bun dev`'s compiler pool (`react-compiler-dev.ts`). It hands Babel what the build's
 * plugin does (`@rolldown/plugin-babel` with `reactCompilerPreset`), so a module compiles the same here.
 */

const compiler = fileURLToPath(import.meta.resolve('babel-plugin-react-compiler'));

parentPort?.on('message', async ({ job, code, id }: { job: number; code: string; id: string }) => {
    try {
        const typed = /\.tsx(?:$|\?)/.test(id) ? ['typescript', 'jsx'] : /\.ts(?:$|\?)/.test(id) ? ['typescript'] : /\.jsx(?:$|\?)/.test(id) ? ['jsx'] : [];
        const result = await transformAsync(code, {
            filename: id,
            babelrc: false,
            configFile: false,
            sourceMaps: true,
            parserOpts: { sourceType: 'module', allowAwaitOutsideFunction: true, plugins: typed as ['typescript'] },
            plugins: [[compiler, REACT_COMPILER_OPTIONS]]
        });
        parentPort?.postMessage({ job, code: result?.code ?? null, map: result?.map ?? null });
    } catch (error) {
        parentPort?.postMessage({ job, error: error instanceof Error ? error.message : String(error) });
    }
});
