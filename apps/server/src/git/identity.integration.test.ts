import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GitIdentity } from '@ruimte/contracts';
import { readIdentities } from './identity.ts';
import { gitIn, initRepo } from './test-repo.ts';

let root: string;
let origin: string;

beforeAll(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-git-identity-')));
    origin = join(root, 'origin');
    await initRepo(origin, { 'a.txt': 'a\n' });
});

afterAll(async () => {
    await rm(root, { recursive: true, force: true });
});

async function identityOf(path: string): Promise<GitIdentity> {
    const [identity] = (await readIdentities([path])).identities;
    if (identity === undefined || 'error' in identity) {
        throw new Error(`${path} is not a repository`);
    }
    return identity;
}

test('two clones of one repository share their root commit, and a repository of its own does not', async () => {
    const first = join(root, 'first');
    const second = join(root, 'second');
    await gitIn(root, ['clone', '--quiet', origin, first]);
    await gitIn(root, ['clone', '--quiet', origin, second]);
    const other = join(root, 'other');
    await initRepo(other, { 'b.txt': 'b\n' });

    const [a, b, c] = await Promise.all([identityOf(first), identityOf(second), identityOf(other)]);
    expect(a).toMatchObject({ path: first, branch: 'main', remoteUrl: origin });
    expect(a.rootCommits).toHaveLength(1);
    expect(b.rootCommits).toEqual(a.rootCommits);
    expect(c.rootCommits).not.toEqual(a.rootCommits);
    expect(a.heads).toEqual(a.rootCommits);
});

test('a repository without a remote names none, and lists HEAD first and then every branch tip', async () => {
    const repo = join(root, 'local');
    await initRepo(repo, { 'c.txt': 'c\n' });
    await gitIn(repo, ['switch', '--quiet', '--create', 'feature']);
    await gitIn(repo, ['commit', '--quiet', '--allow-empty', '--message', 'ahead']);
    const head = (await gitIn(repo, ['rev-parse', 'HEAD'])).trim();
    const main = (await gitIn(repo, ['rev-parse', 'main'])).trim();

    const identity = await identityOf(repo);
    expect(identity).toMatchObject({ path: repo, branch: 'feature', heads: [head, main] });
    expect('remoteUrl' in identity).toBe(false);
});

test('a detached HEAD names no branch', async () => {
    const repo = join(root, 'detached');
    await initRepo(repo, { 'd.txt': 'd\n' });
    await gitIn(repo, ['checkout', '--quiet', '--detach']);
    expect('branch' in (await identityOf(repo))).toBe(false);
});

test('the credentials of a remote stay on the machine', async () => {
    const repo = join(root, 'credentials');
    await initRepo(repo, { 'e.txt': 'e\n' });
    await gitIn(repo, ['remote', 'add', 'origin', 'https://ada:secret@example.com/owner/repo.git']);
    expect(await identityOf(repo)).toMatchObject({ remoteUrl: 'https://example.com/owner/repo.git' });
});

test('a repository without a commit has nothing to compare yet', async () => {
    const repo = join(root, 'empty');
    await mkdir(repo);
    await gitIn(repo, ['init', '--quiet']);
    expect(await identityOf(repo)).toMatchObject({ path: repo, rootCommits: [], heads: [] });
});

test('a folder outside git, and one that is not there, are not repositories', async () => {
    const plain = join(root, 'plain');
    await mkdir(plain);
    expect((await readIdentities([plain, join(root, 'missing')])).identities).toEqual([
        { path: plain, error: 'not-a-repository' },
        { path: join(root, 'missing'), error: 'not-a-repository' }
    ]);
});
