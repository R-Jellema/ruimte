import type { GitIdentity, GitIdentityResult } from '@ruimte/contracts';
import { readGit } from './run.ts';

// The same cap the contract holds the lists to.
const MAX_LISTED = 50;

/* A remote URL goes to another machine, and `https://user:token@host/repo.git` must not take the token along. */
export function withoutCredentials(url: string): string {
    try {
        const parsed = new URL(url);
        if (parsed.username === '' && parsed.password === '') {
            return url;
        }
        parsed.username = '';
        parsed.password = '';
        return parsed.href;
    } catch {
        // An scp-style address (git@host:owner/repo) is no URL and carries no password.
        return url;
    }
}

function linesOf(output: string | null): string[] {
    return (output ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '');
}

/* What a checkout is, read without taking a lock: the history it starts from, where it came from and where its branches stand. */
export async function readIdentity(path: string): Promise<GitIdentity | null> {
    if ((await readGit(['rev-parse', '--git-dir'], path)) === null) {
        return null;
    }
    const [roots, remote, branch, head, branches] = await Promise.all([
        readGit(['rev-list', '--max-parents=0', 'HEAD'], path),
        readGit(['remote', 'get-url', 'origin'], path),
        readGit(['symbolic-ref', '--short', 'HEAD'], path),
        readGit(['rev-parse', '--verify', 'HEAD'], path),
        readGit(['for-each-ref', '--format=%(objectname)', 'refs/heads'], path)
    ]);
    const remoteUrl = remote?.trim() ?? '';
    const branchName = branch?.trim() ?? '';
    return {
        path,
        rootCommits: linesOf(roots).slice(0, MAX_LISTED),
        ...(remoteUrl === '' ? {} : { remoteUrl: withoutCredentials(remoteUrl) }),
        ...(branchName === '' ? {} : { branch: branchName }),
        heads: [...new Set([...linesOf(head), ...linesOf(branches)])].slice(0, MAX_LISTED)
    };
}

export async function readIdentities(paths: readonly string[]): Promise<GitIdentityResult> {
    const identities: GitIdentityResult['identities'] = [];
    for (const path of paths) {
        identities.push((await readIdentity(path)) ?? { path, error: 'not-a-repository' });
    }
    return { identities };
}
