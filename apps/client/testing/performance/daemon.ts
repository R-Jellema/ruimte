import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthTicketResultSchema, MACHINE_HEALTH_PATH } from '@ruimte/contracts';
import { proveDaemon } from '../../../desktop/src/daemon-proof';
import { LinkTransport } from '../../src/transport/link-transport';
import { socketLink } from '../../src/transport/websocket-transport';
import { measureRestore } from './restore';

const root = await mkdtemp(join(tmpdir(), 'ruimte-daemon-bench-'));
const runs = Number(process.env.BENCH_RUNS ?? 5);
const pollMs = Number(process.env.BENCH_POLL_MS ?? 10);
const samples = [];
try {
    for (let run = 0; run < runs; run++) {
        const home = process.env.BENCH_RESTORE === '1' ? join(root, `home-${run}`) : root;
        const reservation = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
        const port = reservation.port!;
        await reservation.stop(true);
        const started = performance.now();
        const child = Bun.spawn(
            [
                ...(process.env.BENCH_DAEMON_BINARY
                    ? [process.env.BENCH_DAEMON_BINARY]
                    : [
                          process.execPath,
                          '--conditions=source',
                          ...(process.env.BENCH_DAEMON_PRELOAD ? ['--preload', process.env.BENCH_DAEMON_PRELOAD] : []),
                          'src/main.ts'
                      ]),
                '--host',
                '127.0.0.1',
                '--port',
                String(port),
                '--no-hooks',
                '--no-broker',
                '--no-lan',
                '--no-stun',
                '--no-model-fetch',
                '--no-price-fetch'
            ],
            { cwd: join(import.meta.dir, '../../../server'), env: { ...process.env, RUIMTE_HOME: home }, stdout: 'pipe', stderr: 'pipe' }
        );
        const stdout = new Response(child.stdout).text();
        const stderr = new Response(child.stderr).text();
        let transport: LinkTransport | null = null;
        let connectedTimer: ReturnType<typeof setTimeout> | undefined;
        try {
            const base = `http://127.0.0.1:${port}`;
            let listening = false;
            while (performance.now() - started < 30_000 && child.exitCode === null) {
                const response = await fetch(`${base}${MACHINE_HEALTH_PATH}`, { signal: AbortSignal.timeout(200) }).catch(() => null);
                if (response?.ok) {
                    listening = true;
                    break;
                }
                await Bun.sleep(pollMs);
            }
            if (!listening) {
                throw new Error(`Daemon did not listen; exit code ${child.exitCode}`);
            }
            const listeningMs = performance.now() - started;
            const secret = (await readFile(join(home, 'local.key'), 'utf8')).trim();
            if (!(await proveDaemon({ port, readSecret: async () => secret, nonce: () => randomBytes(16).toString('hex'), fetch }))) {
                throw new Error('Local daemon did not prove its identity');
            }
            const provenMs = performance.now() - started;
            const ticketResponse = await fetch(`${base}/auth/local-ticket`, { method: 'POST', headers: { authorization: `Bearer ${secret}` } });
            const { ticket } = AuthTicketResultSchema.parse(await ticketResponse.json());
            const ticketMs = performance.now() - started;
            transport = new LinkTransport(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(ticket)}`, socketLink, {
                log: { info: () => undefined, warn: () => undefined }
            });
            await new Promise<void>((resolve, reject) => {
                connectedTimer = setTimeout(() => reject(new Error('Local protocol handshake timed out')), 10_000);
                const ready = (): void => {
                    if (transport!.status === 'open') {
                        clearTimeout(connectedTimer);
                        resolve();
                    }
                };
                transport!.subscribeStatus(ready);
                ready();
            });
            const connectedMs = performance.now() - started;
            const result = await transport.request('project.list', {});
            if (result.projects.length !== 0) {
                throw new Error('Fresh benchmark home unexpectedly contains projects');
            }
            samples.push({ listeningMs, provenMs, ticketMs, connectedMs, projectsMs: performance.now() - started });
            if (process.env.BENCH_RESTORE === '1') {
                const opened = await transport.request('project.open', { folder: join(home, 'scratch/benchmark-project'), createFolder: true });
                const restore = await measureRestore({ daemonUrl: base, secret, projectId: opened.summary.projectId, profile: join(root, `browser-${run}`) });
                Object.assign(samples[run]!, { restore });
            }
        } finally {
            clearTimeout(connectedTimer);
            transport?.dispose();
            child.kill('SIGTERM');
            const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
            await child.exited;
            clearTimeout(timeout);
            const output = await stdout;
            await stderr;
            const phases = output.split('\n').flatMap((line) => {
                const marker = line.indexOf('[PERF_PHASE]');
                return marker < 0 ? [] : [JSON.parse(line.slice(marker + '[PERF_PHASE]'.length))];
            });
            if (phases.length > 0 && samples[run]) {
                Object.assign(samples[run]!, { phases });
            }
        }
    }
    console.log(
        JSON.stringify(
            {
                benchmark: 'daemon-local-startup',
                runs,
                pollMs,
                mode: process.env.BENCH_DAEMON_BINARY ? 'compiled' : 'source',
                instrumented: Boolean(process.env.BENCH_DAEMON_PRELOAD),
                samples
            },
            null,
            2
        )
    );
    const ordered = samples.map((sample) => sample.projectsMs).toSorted((left, right) => left - right);
    if (ordered[Math.floor(ordered.length / 2)]! > Number(process.env.BENCH_MAX_STARTUP_MS ?? Infinity)) {
        throw new Error('Local daemon startup exceeded its timing budget');
    }
} finally {
    await rm(root, { recursive: true, force: true });
}
