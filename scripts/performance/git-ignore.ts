import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ignoredPaths } from '../../apps/server/src/git/ignore';
import { runGit } from '../../apps/server/src/git/run';
import { assertMedianWithin } from './budget';

const count = Number(process.env.BENCH_PATHS ?? 1800);
const runs = Number(process.env.BENCH_RUNS ?? 9);
if (![count, runs].every((value) => Number.isInteger(value) && value > 0)) {
    throw new Error('BENCH_PATHS and BENCH_RUNS must be positive integers');
}
const root = await mkdtemp(join(tmpdir(), 'ruimte-git-ignore-bench-'));
try {
    const repository = join(root, 'repository');
    const alias = join(root, 'alias');
    await mkdir(repository);
    await symlink(repository, alias, 'dir');
    const globalConfig = join(root, 'global.gitconfig');
    await writeFile(globalConfig, '');
    process.env.GIT_CONFIG_GLOBAL = globalConfig;
    process.env.GIT_CONFIG_NOSYSTEM = '1';
    const init = await runGit(['init', '-q'], repository);
    if (init.code !== 0) {
        throw new Error(init.stderr);
    }
    await writeFile(join(repository, '.gitignore'), '*.log\n');
    const names = Array.from({ length: count }, (_, index) => `item${index}.${index % 5 === 0 ? 'log' : 'ts'}`);
    for (let start = 0; start < names.length; start += 100) {
        await Promise.all(names.slice(start, start + 100).map((name) => writeFile(join(repository, name), '')));
    }
    const canonical = await realpath(repository);
    const versions: Array<{ stage: string; read: typeof ignoredPaths }> = [{ stage: 'current', read: ignoredPaths }];
    if (process.env.BENCH_IGNORE_CONTROL_SOURCE) {
        const gitRoot = resolve(import.meta.dir, '../../apps/server/src/git');
        const source = (await Bun.file(process.env.BENCH_IGNORE_CONTROL_SOURCE).text()).replace(
            /(from\s+)(['"])(\.[^'"]+)\2/g,
            (_match, prefix: string, _quote: string, path: string) => `${prefix}${JSON.stringify(resolve(gitRoot, path))}`
        );
        const controlPath = join(root, 'control.ts');
        await writeFile(controlPath, source);
        versions.unshift({ stage: 'control', read: (await import(controlPath)).ignoredPaths as typeof ignoredPaths });
    }
    const measurements = [];
    for (const mode of ['canonical', 'alias', 'relative']) {
        const cwd = mode === 'canonical' ? canonical : alias;
        const paths = mode === 'relative' ? names : names.map((name) => join(cwd, name));
        const expected = paths.filter((_path, index) => index % 5 === 0);
        const samples = new Map(versions.map((version) => [version.stage, [] as number[]]));
        for (let run = -1; run < runs; run++) {
            for (const version of run % 2 === 0 ? versions : versions.toReversed()) {
                const started = performance.now();
                const ignored = await version.read(paths, cwd);
                const ms = performance.now() - started;
                if (ignored.size !== expected.length || expected.some((path) => !ignored.has(path))) {
                    throw new Error(`Git ignore answers changed for ${mode}`);
                }
                if (run >= 0) {
                    samples.get(version.stage)!.push(ms);
                }
            }
        }
        for (const [stage, timing] of samples) {
            measurements.push({ mode, stage, samples: timing });
        }
    }
    console.log(JSON.stringify({ benchmark: 'git-ignore-paths', count, runs, measurements }, null, 2));
    assertMedianWithin(
        measurements.find((row) => row.mode === 'alias' && row.stage === 'current')!.samples,
        'BENCH_MAX_ALIAS_MS',
        'Git ignore through a directory alias exceeded its timing budget'
    );
} finally {
    await rm(root, { recursive: true, force: true });
}
