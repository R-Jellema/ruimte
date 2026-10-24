import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FS_LIST_MAX_ENTRIES } from '../../packages/contracts/src/fs';

const control = process.env.BENCH_LIST_SOURCE;
if (control) {
    Bun.plugin({
        name: 'file-list-control',
        setup(builder) {
            builder.onLoad({ filter: /\/apps\/server\/src\/fs\/list\.ts$/ }, async () => ({ contents: await Bun.file(control).text(), loader: 'ts' }));
        }
    });
}
const { listDirectory } = await import('../../apps/server/src/fs/list');

const files = Number(process.env.BENCH_FILES ?? 1800);
const runs = Number(process.env.BENCH_RUNS ?? 9);
if (!Number.isInteger(files) || files < 1 || files > 100_000 || !Number.isInteger(runs) || runs < 1) {
    throw new Error('BENCH_FILES must be between 1 and 100000; BENCH_RUNS must be positive');
}
const root = await mkdtemp(join(tmpdir(), 'ruimte-file-list-bench-'));
try {
    const names = Array.from({ length: files }, (_, index) => `item${index + 1}.ts`);
    for (let start = 0; start < names.length; start += 100) {
        await Promise.all(names.slice(start, start + 100).map((name) => writeFile(join(root, name), 'export {};\n')));
    }
    await mkdir(join(root, 'folder10'));
    await mkdir(join(root, 'folder2'));
    const repository = process.env.BENCH_REPOSITORY === '1';
    if (repository) {
        const git = Bun.spawn(['git', 'init', '-q', root], { stdout: 'ignore', stderr: 'pipe' });
        if ((await git.exited) !== 0) {
            throw new Error(await new Response(git.stderr).text());
        }
    }
    const expected = ['folder2', 'folder10', ...names].slice(0, FS_LIST_MAX_ENTRIES);
    const samples = [];
    for (let run = -1; run < runs; run++) {
        const started = performance.now();
        const result = await listDirectory(root);
        const ms = performance.now() - started;
        if (
            result.truncated !== files + 2 > FS_LIST_MAX_ENTRIES ||
            result.entries.length !== expected.length ||
            result.entries.some((entry, index) => entry.name !== expected[index] || (entry.kind === 'file' && entry.size !== 11))
        ) {
            throw new Error('Directory listing changed its order or metadata');
        }
        if (run >= 0) {
            samples.push(ms);
        }
    }
    console.log(JSON.stringify({ benchmark: 'file-list', files, runs, repository, control: Boolean(control), samples }, null, 2));
    const median = samples.toSorted((left, right) => left - right)[Math.floor(runs / 2)]!;
    if (median > Number(process.env.BENCH_MAX_LIST_MS ?? Infinity)) {
        throw new Error('File listing exceeded its timing budget');
    }
} finally {
    await rm(root, { recursive: true, force: true });
}
