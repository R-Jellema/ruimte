import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = await mkdtemp(join(tmpdir(), 'ruimte-sidebar-browser-'));
const baseline = process.env.BENCH_SIDEBAR_SOURCE;
const profiles = Number(process.env.BENCH_PROFILES ?? 3);
const samples = [];
try {
    for (const stage of baseline ? ['control', 'current'] : ['current']) {
        const output = join(root, `${stage}.js`);
        const build = await Bun.build({
            entrypoints: [join(import.meta.dir, 'sidebar.ts')],
            target: 'browser',
            format: 'esm',
            conditions: ['source'],
            minify: { syntax: true, whitespace: true },
            define: {
                'process.env.BENCH_PROJECTS': JSON.stringify(process.env.BENCH_PROJECTS ?? '20'),
                'process.env.BENCH_VIEWS': JSON.stringify(process.env.BENCH_VIEWS ?? '100'),
                'process.env.BENCH_UPDATES': JSON.stringify(process.env.BENCH_UPDATES ?? '200'),
                'process.env.BENCH_RUNS': JSON.stringify(process.env.BENCH_RUNS ?? '7'),
                'process.env.BENCH_MAX_STATUS_MS': '"Infinity"'
            },
            plugins:
                stage === 'control'
                    ? [
                          {
                              name: 'sidebar-control',
                              setup(builder) {
                                  builder.onLoad({ filter: /\/apps\/client\/src\/shell\/sidebar-watch\.ts$/ }, async () => ({
                                      contents: await Bun.file(baseline!).text(),
                                      loader: 'ts'
                                  }));
                              }
                          }
                      ]
                    : []
        });
        if (!build.success) {
            throw new AggregateError(build.logs, 'Sidebar benchmark did not build');
        }
        await Bun.write(output, build.outputs[0]!);
        const server = Bun.serve({
            hostname: '127.0.0.1',
            port: 0,
            fetch(request) {
                if (new URL(request.url).pathname === '/bench.js') {
                    return new Response(Bun.file(output), { headers: { 'content-type': 'text/javascript' } });
                }
                return new Response(
                    `<!doctype html><script>
                window.benchReady=new Promise((resolve,reject)=>{
                    const timer=setTimeout(()=>reject(new Error('Sidebar benchmark timed out')),20000);
                    console.log=raw=>{clearTimeout(timer);resolve(JSON.parse(raw));};
                    addEventListener('error',event=>reject(new Error(event.message)));
                    addEventListener('unhandledrejection',event=>reject(new Error(String(event.reason))));
                });
                </script><script type="module" src="/bench.js"></script>`,
                    { headers: { 'content-type': 'text/html' } }
                );
            }
        });
        try {
            for (let run = 0; run < profiles; run++) {
                const view = new Bun.WebView({
                    backend: { type: 'chrome', url: false },
                    headless: true,
                    dataStore: { directory: join(root, `${stage}-${run}`) }
                });
                try {
                    await view.navigate(`http://127.0.0.1:${server.port}`);
                    samples.push({ stage, run, result: await view.evaluate('window.benchReady') });
                } finally {
                    await view.close();
                }
            }
        } finally {
            await server.stop(true);
        }
    }
    console.log(JSON.stringify({ benchmark: 'sidebar-status-browser', samples }, null, 2));
} finally {
    await rm(root, { recursive: true, force: true });
}
