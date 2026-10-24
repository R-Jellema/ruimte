import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface BrowserScriptOptions {
    control?: { filter: RegExp; source: string };
    env: Record<string, string>;
    profiles?: number;
}

export async function browserScriptSamples(entry: string, options: BrowserScriptOptions): Promise<unknown[]> {
    const root = await mkdtemp(join(tmpdir(), 'ruimte-script-browser-'));
    const samples = [];
    try {
        for (const stage of options.control ? ['control', 'current'] : ['current']) {
            const output = join(root, `${stage}.js`);
            const build = await Bun.build({
                entrypoints: [entry],
                target: 'browser',
                format: 'esm',
                conditions: ['source'],
                minify: { syntax: true, whitespace: true },
                define: Object.fromEntries(
                    Object.entries({ NODE_ENV: 'production', ...options.env }).map(([key, value]) => [`process.env.${key}`, JSON.stringify(value)])
                ),
                plugins:
                    stage === 'control'
                        ? [
                              {
                                  name: 'benchmark-control',
                                  setup(builder) {
                                      builder.onLoad({ filter: options.control!.filter }, async () => ({
                                          contents: await Bun.file(options.control!.source).text(),
                                          loader: 'ts'
                                      }));
                                  }
                              }
                          ]
                        : []
            });
            if (!build.success) {
                throw new AggregateError(build.logs, 'Browser benchmark did not build');
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
                            const timer=setTimeout(()=>reject(new Error('Browser benchmark timed out')),30000);
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
                for (let run = 0; run < (options.profiles ?? 3); run++) {
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
        return samples;
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}
