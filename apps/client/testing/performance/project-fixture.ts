import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MACHINE_HEALTH_PATH } from '@ruimte/contracts';
import { ProjectStore } from '../../../server/src/projects/project-store';
import { projectLinks } from '../../../server/src/projects/project-file-test-helpers';

interface ProjectFixture {
    daemonUrl: string;
    secret: string;
    projectId: string;
    profile: string;
    filePath: string;
}

export async function withProjectFixture<Result>(
    options: { projects: number; views: number; looseFile?: boolean },
    run: (fixture: ProjectFixture) => Promise<Result>
): Promise<Result> {
    const root = await mkdtemp(join(tmpdir(), 'ruimte-project-fixture-'));
    const home = join(root, 'home');
    const seed = new ProjectStore(home, projectLinks());
    let first = '';
    let child: Bun.Subprocess<'ignore', 'pipe', 'pipe'> | undefined;
    let stdout: Promise<string> | undefined;
    let stderr: Promise<string> | undefined;
    try {
        for (let project = 0; project < options.projects; project++) {
            const opened = await seed.openProject({ folder: join(root, `project-${project}`), createFolder: true });
            if (project === 0) {
                first = opened.summary.projectId;
            }
            await Bun.write(join(opened.summary.folder, 'fixture.txt'), 'Sidebar benchmark.\n');
            await seed.save(opened.summary.projectId, opened.document.rev, {
                name: `Project ${project}`,
                color: 'blue',
                views: Array.from({ length: options.views }, (_, index) =>
                    index === 0
                        ? { id: `view-${project}-${index}`, name: `File ${index}`, kind: 'file', path: 'fixture.txt' }
                        : { id: `view-${project}-${index}`, name: `Chat ${index}`, kind: 'chat', node: { provider: 'claude' } }
                )
            });
            const loosePath = join(opened.summary.folder, 'fixture.txt');
            await seed.saveLocal(
                opened.summary.projectId,
                options.looseFile
                    ? {
                          ...opened.local,
                          activeViewId: loosePath,
                          layout: { columns: [{ size: 1, cells: [{ size: 1, viewId: loosePath }] }], focus: { column: 0, cell: 0 } },
                          panels: { panel: { open: false, kind: 'files' }, strip: [{ kind: 'file', path: loosePath, pinned: true }] }
                      }
                    : { ...opened.local, activeViewId: options.views > 0 ? `view-${project}-0` : null }
            );
            seed.release(opened.summary.projectId);
        }
        seed.closeAll();
        const reservation = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
        const port = reservation.port!;
        await reservation.stop(true);
        child = Bun.spawn(
            [
                process.execPath,
                '--conditions=source',
                ...(process.env.BENCH_DAEMON_PRELOAD ? ['--preload', process.env.BENCH_DAEMON_PRELOAD] : []),
                'src/main.ts',
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
            { cwd: join(import.meta.dir, '../../../server'), env: { ...process.env, RUIMTE_HOME: home }, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' }
        );
        stdout = new Response(child.stdout).text();
        stderr = new Response(child.stderr).text();
        const daemonUrl = `http://127.0.0.1:${port}`;
        let ready = false;
        for (let attempt = 0; attempt < 300 && child.exitCode === null; attempt++) {
            if ((await fetch(`${daemonUrl}${MACHINE_HEALTH_PATH}`, { signal: AbortSignal.timeout(200) }).catch(() => null))?.ok) {
                ready = true;
                break;
            }
            await Bun.sleep(100);
        }
        if (!ready) {
            throw new Error('Isolated project daemon did not start');
        }
        const secret = (await readFile(join(home, 'local.key'), 'utf8')).trim();
        const filePath = join(root, 'project-0', 'fixture.txt');
        return await run({
            daemonUrl,
            secret,
            projectId: first,
            profile: join(root, 'profiles'),
            filePath
        });
    } finally {
        seed.closeAll();
        if (child) {
            child.kill('SIGTERM');
            const timeout = setTimeout(() => child!.kill('SIGKILL'), 5000);
            await child.exited;
            clearTimeout(timeout);
            await stdout;
            await stderr;
        }
        await rm(root, { recursive: true, force: true });
    }
}
