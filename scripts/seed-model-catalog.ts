import { resolve } from 'node:path';
import { seedRefusalOf, seedStatementsOf } from '../apps/pulsar-worker/src/catalog-seed.ts';

const WORKER_ROOT = resolve(import.meta.dir, '../apps/pulsar-worker');
const ADECORE_CATALOGS = resolve(import.meta.dir, '../../adecore/packages/agents/src/providers');

async function wrangler(command: string): Promise<unknown> {
    const child = Bun.spawn(['bunx', 'wrangler', 'd1', 'execute', 'ruimte-pulsar', '--remote', '--json', '--command', command], {
        cwd: WORKER_ROOT,
        stdout: 'pipe',
        stderr: 'inherit'
    });

    const output = await new Response(child.stdout).text();

    if ((await child.exited) !== 0) {
        throw new Error(`Wrangler failed: ${output.trim()}`);
    }

    return JSON.parse(output);
}

/* Fills one kind in D1 from its manifest, by default the one in the `../adecore` checkout. */
async function seed(kind: string, file: string | undefined, force: boolean): Promise<string> {
    const path = file === undefined ? resolve(ADECORE_CATALOGS, `${kind}-models.json`) : resolve(file);
    const catalog: unknown = JSON.parse(await Bun.file(path).text());
    const answer = (await wrangler(`SELECT kind FROM model_catalogs WHERE kind = '${kind.replaceAll("'", "''")}'`)) as Array<{ results: unknown[] }>;
    const refusal = seedRefusalOf(kind, catalog, (answer[0]?.results.length ?? 0) > 0, force);

    if (refusal !== null) {
        throw new Error(refusal);
    }

    // A run that fails halfway says so, the Worker answers the bundled catalog meanwhile, and `--force` writes it again.
    await wrangler(seedStatementsOf(kind, catalog as never).join(';\n'));

    return `Seeded the ${kind} catalog from ${path}.`;
}

if (import.meta.main) {
    const args = process.argv.slice(2);
    const force = args.includes('--force');
    const [kind, file] = args.filter((arg) => arg !== '--force');

    try {
        if (kind === undefined) {
            throw new Error('Usage: bun scripts/seed-model-catalog.ts <kind> [file] [--force]');
        }

        console.log(await seed(kind, file, force));
    } catch (error) {
        console.error(error instanceof Error ? error.message : 'Seeding the catalog failed.');
        process.exitCode = 1;
    }
}
