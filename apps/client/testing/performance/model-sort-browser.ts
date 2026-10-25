import { join } from 'node:path';
import { browserScriptSamples } from './browser-script';

const control = process.env.BENCH_MODEL_SORT_SOURCE;
const samples = await browserScriptSamples(join(import.meta.dir, 'model-sort.ts'), {
    control: control ? { filter: /\/agents-react\/src\/chat\/logic\/picker-entries\.ts$/, source: control } : undefined,
    profiles: Number(process.env.BENCH_PROFILES ?? 3),
    env: { BENCH_MODELS: process.env.BENCH_MODELS ?? '700', BENCH_RUNS: process.env.BENCH_RUNS ?? '9', BENCH_MAX_SORT_MS: 'Infinity' }
});
console.log(JSON.stringify({ benchmark: 'model-sort-browser', samples }, null, 2));
