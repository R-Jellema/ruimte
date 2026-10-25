import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dir, '../..');
const server = join(root, 'apps/server');
const temporary = await mkdtemp(join(tmpdir(), 'ruimte-cli-probe-bench-'));
const delayMs = Number(process.env.BENCH_PROBE_DELAY_MS ?? '300');
const control = process.env.BENCH_CONTROL_REF;
if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new Error('BENCH_PROBE_DELAY_MS must be nonnegative');
}
const changedFiles = new Set(['daemon.ts', 'providers/launch.ts', 'sessions/manager.ts', 'wiring/agents.ts', 'wiring/providers.ts']);
try {
    const executable = join(temporary, 'daemon');
    const build = await Bun.build({
        entrypoints: ['src/main.ts', 'src/fs/grep-worker.ts', 'src/telemetry/watchdog-worker.ts'].map((path) => join(server, path)),
        conditions: ['source'],
        target: 'bun',
        format: 'esm',
        compile: { outfile: executable },
        bytecode: true,
        minify: { whitespace: true, syntax: true },
        sourcemap: 'external',
        define: { 'process.env.RUIMTE_TELEMETRY': '""' },
        plugins: [
            {
                name: 'controlled-cli-latency',
                setup(builder) {
                    builder.onLoad({ filter: /\/apps\/server\/src\/.*\.ts$/ }, async ({ path }) => {
                        const name = relative(join(server, 'src'), path);
                        if (!changedFiles.has(name)) {
                            return undefined;
                        }
                        let contents: string;
                        if (control) {
                            const source = Bun.spawnSync(['git', 'show', `${control}:${relative(root, path)}`], { cwd: root });
                            if (source.exitCode !== 0) {
                                throw new Error(source.stderr.toString());
                            }
                            contents = source.stdout.toString();
                        } else {
                            contents = await Bun.file(path).text();
                        }
                        contents = contents.replace(
                            'probeCodexNoDaemon()',
                            `probeCodexNoDaemon(async () => { await Bun.sleep(${delayMs}); return '--no-daemon'; })`
                        );
                        // Both controls defer endpoint events: slow boot otherwise exposes an unrelated binding race.
                        contents = contents.replace('    integrations.onChanged(() => identity.announce());\n', '');
                        contents = contents.replace('    providers.integrations.onChanged(() => identity.announce());\n', '');
                        contents = contents.replace(
                            '    void providers.integrations.installDefaults();',
                            '    providers.integrations.onChanged(() => identity.announce());\n    void providers.integrations.installDefaults();'
                        );
                        return { contents, loader: 'ts' };
                    });
                }
            }
        ]
    });
    if (!build.success) {
        throw new AggregateError(build.logs, 'Daemon compilation failed');
    }
    // File validation on the first execution is a separate measurement from application boot work.
    const warm = Bun.spawn([executable, '--version'], { stdout: 'ignore', stderr: 'pipe' });
    if ((await warm.exited) !== 0) {
        throw new Error(await new Response(warm.stderr).text());
    }
    const measure = Bun.spawn([process.execPath, '--conditions=source', 'apps/client/testing/performance/daemon.ts'], {
        cwd: root,
        env: { ...process.env, BENCH_DAEMON_BINARY: executable },
        stdout: 'pipe',
        stderr: 'pipe'
    });
    const [output, errors, exitCode] = await Promise.all([new Response(measure.stdout).text(), new Response(measure.stderr).text(), measure.exited]);
    console.log(JSON.stringify({ benchmark: 'daemon-cli-probe-startup', delayMs, control: control ?? 'working-tree', samples: JSON.parse(output) }, null, 2));
    if (exitCode !== 0) {
        throw new Error(errors);
    }
} finally {
    await rm(temporary, { recursive: true, force: true });
}
