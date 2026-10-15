import { mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { BUNDLE_MAX_BYTES, type GitBundlePayload, type GitBundleResult } from '@ruimte/contracts';
import type { CheckpointService } from './checkpoints.ts';
import { GitError, git, gitOrThrow, runGit, toplevel } from './run.ts';

const ID = /^[a-z0-9][a-z0-9-]{5,63}$/;
const COMMIT = /^[0-9a-f]{7,64}$/;
const HANDOFF = 'refs/ruimte/handoff/';

const TOO_BIG = `A bundle over ${BUNDLE_MAX_BYTES / 1024 / 1024} MiB is not sent. Push the branch to origin and fetch it there instead.`;

/*
 * The bundles this machine wrote for another machine to read. They live under `$RUIMTE_HOME/bundles`
 * and nothing outside it is reachable by an id, since an id is only a name of that folder.
 */
export class BundleStore {
    readonly root: string;

    constructor(home: string) {
        this.root = join(home, 'bundles');
    }

    static isId(id: string): boolean {
        return ID.test(id);
    }

    pathOf(id: string): string {
        return join(this.root, `${this.checked(id)}.bundle`);
    }

    /* The file of a bundle this machine wrote, or null when it is gone. */
    async made(id: string): Promise<string | null> {
        if (!BundleStore.isId(id)) {
            return null;
        }
        const path = this.pathOf(id);
        return (await stat(path).catch(() => null))?.isFile() ? path : null;
    }

    private checked(id: string): string {
        if (!BundleStore.isId(id)) {
            throw new GitError('bundle-missing', 'Not a bundle id');
        }
        return id;
    }
}

/* Keeps the hash of a file without holding it in memory. */
export async function sha256Of(path: string): Promise<string> {
    const hasher = new Bun.CryptoHasher('sha256');
    for await (const chunk of Bun.file(path).stream()) {
        hasher.update(chunk);
    }
    return hasher.digest('hex');
}

/* Git commits as someone even where nobody set a name, since the handoff commit is the daemon's. */
async function committer(top: string): Promise<Record<string, string>> {
    const [name, email] = await Promise.all([git(['config', 'user.name'], top), git(['config', 'user.email'], top)]);
    return {
        ...(name?.trim() ? {} : { GIT_AUTHOR_NAME: 'Ruimte', GIT_COMMITTER_NAME: 'Ruimte' }),
        ...(email?.trim() ? {} : { GIT_AUTHOR_EMAIL: 'ruimte@localhost', GIT_COMMITTER_EMAIL: 'ruimte@localhost' })
    };
}

async function commitOf(top: string, ref: string): Promise<string | null> {
    return (await git(['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`], top))?.trim() || null;
}

/* The commits of `haves` this repository has too, since a bundle can only leave out what the receiver and the sender share. */
async function sharedCommits(top: string, haves: readonly string[]): Promise<string[]> {
    const shared: string[] = [];
    for (let at = 0; at < haves.length; at += 8) {
        const batch = haves.slice(at, at + 8).filter((have) => COMMIT.test(have));
        const known = await Promise.all(batch.map(async (have) => (await runGit(['cat-file', '-e', `${have}^{commit}`], top)).code === 0));
        shared.push(...batch.filter((_have, i) => known[i]));
    }
    return shared;
}

/*
 * Writes a checkout's state as a bundle. The state is a commit made from a tree (the working tree
 * through the checkpoint index, or HEAD's tree) on top of HEAD, or the tip of a branch; the person's
 * index, stashes, branches and files stay as they were. The bundle names its tip under a ref of its
 * own so it can be fetched without a branch name in common.
 */
export async function makeBundle(
    store: BundleStore,
    checkpoints: Pick<CheckpointService, 'take' | 'head'>,
    payload: GitBundlePayload
): Promise<GitBundleResult> {
    const top = await toplevel(payload.path);
    const id = crypto.randomUUID();
    const ref = `${HANDOFF}${id}`;
    const head = await commitOf(top, 'HEAD');
    let commit: string;
    let base: string | null = head;
    if (payload.from === 'branch') {
        if (payload.branch === undefined) {
            throw new GitError('no-branch', 'A bundle of a branch names the branch.');
        }
        const tip = await commitOf(top, payload.branch);
        if (tip === null) {
            throw new GitError('ref-not-found', `${payload.branch} is not a branch, tag or commit of this repository.`);
        }
        commit = tip;
        base = null;
    } else {
        const tree =
            payload.from === 'files'
                ? await checkpoints.take(top)
                : head === null
                  ? null
                  : (await git(['rev-parse', '--verify', `${head}^{tree}`], top))?.trim() || null;
        if (tree === null) {
            throw new GitError(
                'ref-not-found',
                payload.from === 'files' ? 'The files of this checkout could not be read.' : 'This checkout has no commit yet.'
            );
        }
        const written = await gitOrThrow(
            ['-c', 'commit.gpgSign=false', 'commit-tree', tree, ...(head === null ? [] : ['-p', head]), '-m', payload.name],
            top,
            await committer(top)
        );
        commit = written.trim();
    }
    const haves = await sharedCommits(top, payload.haves);
    if (base === null && haves.length > 0) {
        base = (await git(['merge-base', commit, ...haves], top))?.trim().split('\n')[0] || null;
    }
    const path = store.pathOf(id);
    await mkdir(store.root, { recursive: true, mode: 0o700 });
    await gitOrThrow(['update-ref', ref, commit], top);
    try {
        const made = await runGit(['bundle', 'create', '--quiet', path, ref, ...(haves.length > 0 ? ['--not', ...haves] : [])], top);
        if (made.code !== 0) {
            throw new GitError('git-failed', made.stderr.trim() || 'git bundle failed');
        }
    } finally {
        await runGit(['update-ref', '-d', ref], top);
    }
    const size = (await stat(path)).size;
    if (size > BUNDLE_MAX_BYTES) {
        await rm(path, { force: true });
        throw new GitError('bundle-too-large', TOO_BIG);
    }
    return { bundleId: id, size, sha256: await sha256Of(path), commit, base };
}
