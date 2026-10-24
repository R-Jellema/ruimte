import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { forgetSearchCache, rankFiles, searchFiles } from '../../apps/server/src/fs/search';

const count = Number(process.env.BENCH_FILES ?? 100_000);
const diskCount = Number(process.env.BENCH_DISK_FILES ?? 20_000);
const runs = Number(process.env.BENCH_RUNS ?? 9);
const queries = ['', 'src', 'handler', 'project handler', '~missing'];
function pathOf(index: number): string {
    return `packages/project-${index % 100}/src/handler-${(index * 7919) % count}.ts`;
}
const files = Array.from({ length: count }, (_, index) => pathOf(index));
const ranking = [];
for (const query of queries) {
    rankFiles(files, query, 8);
    const samples = [];
    let result: string[] = [];
    for (let run = 0; run < runs; run++) {
        const started = performance.now();
        result = rankFiles(files, query, 8);
        samples.push(performance.now() - started);
    }
    ranking.push({ query, samples, result });
}

const root = await mkdtemp(join(tmpdir(), 'ruimte-file-search-bench-'));
try {
    const git = Bun.spawn(['git', 'init', '-q', root], { stdout: 'ignore', stderr: 'inherit' });
    if ((await git.exited) !== 0) {
        throw new Error('Could not initialize search fixture');
    }
    await Promise.all(Array.from({ length: 100 }, (_, index) => mkdir(join(root, `packages/project-${index}/src`), { recursive: true })));
    for (let start = 0; start < diskCount; start += 200) {
        await Promise.all(Array.from({ length: Math.min(200, diskCount - start) }, (_, offset) => Bun.write(join(root, pathOf(start + offset)), '')));
    }
    const search = [];
    for (const query of queries) {
        await searchFiles(root, query, 8);
        const samples = [];
        let result: string[] = [];
        for (let run = 0; run < runs; run++) {
            const started = performance.now();
            result = (await searchFiles(root, query, 8)).files;
            samples.push(performance.now() - started);
        }
        if (result.length !== (query === '~missing' ? 0 : 8)) {
            throw new Error(`Unexpected file search results for ${query}: ${JSON.stringify(result)}`);
        }
        search.push({ query, samples, result });
    }
    console.log(JSON.stringify({ benchmark: 'file-search', count, diskCount, runs, ranking, search }, null, 2));
    const broad = search.find((row) => row.query === 'src')!.samples.toSorted((left, right) => left - right);
    if (broad[Math.floor(broad.length / 2)]! > Number(process.env.BENCH_MAX_SEARCH_MS ?? Infinity)) {
        throw new Error('Broad file search exceeded its timing budget');
    }
} finally {
    forgetSearchCache();
    await rm(root, { recursive: true, force: true });
}
