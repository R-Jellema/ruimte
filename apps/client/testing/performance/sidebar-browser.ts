import { join } from 'node:path';
import { browserScriptSamples } from './browser-script';

const control = process.env.BENCH_SIDEBAR_SOURCE;
const samples = await browserScriptSamples(join(import.meta.dir, 'sidebar.ts'), {
    control: control ? { filter: /\/apps\/client\/src\/shell\/sidebar-watch\.ts$/, source: control } : undefined,
    profiles: Number(process.env.BENCH_PROFILES ?? 3),
    env: {
        BENCH_PROJECTS: process.env.BENCH_PROJECTS ?? '20',
        BENCH_VIEWS: process.env.BENCH_VIEWS ?? '100',
        BENCH_UPDATES: process.env.BENCH_UPDATES ?? '200',
        BENCH_RUNS: process.env.BENCH_RUNS ?? '7',
        BENCH_MAX_STATUS_MS: 'Infinity'
    }
});
console.log(JSON.stringify({ benchmark: 'sidebar-status-browser', samples }, null, 2));
