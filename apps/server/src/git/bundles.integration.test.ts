import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BundleStore, makeBundle, sha256Of } from './bundles.ts';
import { Checkpoints } from './checkpoints.ts';
import { gitIn, initRepo } from './test-repo.ts';

let root: string;
let first: Machine;
let second: Machine;

interface Machine {
    home: string;
    repo: string;
    bundles: BundleStore;
    checkpoints: Checkpoints;
}

async function machine(name: string): Promise<Machine> {
    const home = join(root, `${name}-home`);
    await mkdir(home, { recursive: true });
    return {
        home,
        repo: join(root, name),
        bundles: new BundleStore(home),
        checkpoints: new Checkpoints(home)
    };
}

beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-bundles-')));
    first = await machine('first');
    second = await machine('second');
    await initRepo(first.repo, { 'a.txt': 'one\n', 'b.txt': 'two\n' });
    await gitIn(root, ['clone', '--quiet', first.repo, second.repo]);
    for (const [key, value] of Object.entries({ 'user.name': 'Ada', 'user.email': 'a@a', 'commit.gpgSign': 'false', 'gc.auto': '0' })) {
        await gitIn(second.repo, ['config', '--local', key, value]);
    }
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

async function dirty(): Promise<void> {
    await writeFile(join(first.repo, 'a.txt'), 'one, changed\n');
    await writeFile(join(first.repo, 'new.txt'), 'untracked\n');
    await writeFile(join(first.repo, 'staged.txt'), 'staged\n');
    await gitIn(first.repo, ['add', 'staged.txt']);
}

test('the working tree is in the bundle as a commit on HEAD, and the checkout is left as it was', async () => {
    await dirty();
    const statusBefore = await gitIn(first.repo, ['status', '--porcelain=v2', '--branch']);
    const indexBefore = await sha256Of(join(first.repo, '.git', 'index'));
    const head = (await gitIn(first.repo, ['rev-parse', 'HEAD'])).trim();

    const made = await makeBundle(first.bundles, first.checkpoints, { path: first.repo, from: 'files', haves: [], name: 'Handoff' });

    expect(await gitIn(first.repo, ['status', '--porcelain=v2', '--branch'])).toBe(statusBefore);
    expect(await sha256Of(join(first.repo, '.git', 'index'))).toBe(indexBefore);
    expect(await gitIn(first.repo, ['for-each-ref', 'refs/ruimte'])).toBe('');
    expect(made.base).toBe(head);
    expect(made.size).toBe(Bun.file(first.bundles.pathOf(made.bundleId)).size);
    expect(made.sha256).toBe(await sha256Of(first.bundles.pathOf(made.bundleId)));

    const read = (path: string): Promise<string> => gitIn(first.repo, ['show', `${made.commit}:${path}`]);
    expect(await read('a.txt')).toBe('one, changed\n');
    expect(await read('new.txt')).toBe('untracked\n');
    expect(await read('staged.txt')).toBe('staged\n');
    expect((await gitIn(first.repo, ['rev-parse', `${made.commit}^`])).trim()).toBe(head);
});

test('what the receiver already has is left out of the bundle, and a have this checkout lacks is ignored', async () => {
    await dirty();
    const head = (await gitIn(first.repo, ['rev-parse', 'HEAD'])).trim();
    const full = await makeBundle(first.bundles, first.checkpoints, { path: first.repo, from: 'head', haves: [], name: 'Full' });
    const lean = await makeBundle(first.bundles, first.checkpoints, {
        path: first.repo,
        from: 'head',
        haves: [head, 'f'.repeat(40), '--all'],
        name: 'Lean'
    });
    expect(lean.size).toBeLessThan(full.size);
    const verified = Bun.spawnSync(['git', 'bundle', 'verify', first.bundles.pathOf(lean.bundleId)], { cwd: second.repo });
    expect(verified.exitCode).toBe(0);
    // HEAD's tree, not the working tree: the change is not in it.
    expect(await gitIn(first.repo, ['show', `${lean.commit}:a.txt`])).toBe('one\n');
});

test('a branch is bundled as it stands', async () => {
    await gitIn(first.repo, ['switch', '--quiet', '--create', 'feature']);
    await writeFile(join(first.repo, 'f.txt'), 'f\n');
    await gitIn(first.repo, ['add', '.']);
    await gitIn(first.repo, ['commit', '--quiet', '--message', 'feature work']);
    await gitIn(first.repo, ['switch', '--quiet', 'main']);
    const tip = (await gitIn(first.repo, ['rev-parse', 'feature'])).trim();
    const base = (await gitIn(first.repo, ['rev-parse', 'main'])).trim();

    const made = await makeBundle(first.bundles, first.checkpoints, { path: first.repo, from: 'branch', branch: 'feature', haves: [base], name: 'Feature' });

    expect(made.commit).toBe(tip);
    expect(made.base).toBe(base);
});
