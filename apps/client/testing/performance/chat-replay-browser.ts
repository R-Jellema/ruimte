import { join } from 'node:path';
import { browserScriptSamples } from './browser-script';

const control = process.env.BENCH_CHATS_SOURCE;
const samples = await browserScriptSamples(join(import.meta.dir, 'chat-replay.ts'), {
    control: control ? { filter: /\/agents-react\/src\/state\/chats\.ts$/, source: control } : undefined,
    profiles: Number(process.env.BENCH_PROFILES ?? 3),
    env: {
        BENCH_ITEMS: process.env.BENCH_ITEMS ?? '6000',
        BENCH_UPDATES: process.env.BENCH_UPDATES ?? '200',
        BENCH_RUNS: process.env.BENCH_RUNS ?? '7',
        BENCH_LIVE: process.env.BENCH_LIVE ?? '0',
        BENCH_MAX_REPLAY_MS: 'Infinity'
    }
});
console.log(JSON.stringify({ benchmark: 'chat-replay-browser', samples }, null, 2));
