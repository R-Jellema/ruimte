import type { GitIssue } from '@ruimte/contracts';
import { GitError, streamWithTimeout, type GitResult } from './run.ts';

// `gh` talks to the network, and a login prompt that cannot be answered would wait for ever.
const GH_TIMEOUT_MS = 30_000;
const GH_ENV = { GH_PROMPT_DISABLED: '1', NO_COLOR: '1' };

// An issue body is quoted into a prompt; past this it is cut instead of filling one.
const MAX_BODY = 60_000;

/* Runs `gh` with these arguments in a folder; a seam so tests hand in answers. */
export type GhRunner = (args: string[], cwd: string) => Promise<GitResult>;

export const runGh: GhRunner = (args, cwd) => streamWithTimeout('gh', args, cwd, GH_TIMEOUT_MS, { env: GH_ENV });

export interface IssueRef {
    /* `owner/repo`; null when the reference leaves it to the folder's own repository. */
    repo: string | null;
    number: number;
}

const URL_FORM = /^https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)(?:[/?#].*)?$/i;
const SHORT_FORM = /^([\w.-]+\/[\w.-]+)#(\d+)$/;
const NUMBER_FORM = /^#(\d+)$/;

/* The three ways a person names an issue: its link, `owner/repo#12` and `#12`. */
export function parseIssueRef(text: string): IssueRef | null {
    const trimmed = text.trim();
    const link = URL_FORM.exec(trimmed) ?? SHORT_FORM.exec(trimmed);
    if (link) {
        return { repo: link[1]!, number: Number.parseInt(link[2]!, 10) };
    }
    const bare = NUMBER_FORM.exec(trimmed);
    return bare ? { repo: null, number: Number.parseInt(bare[1]!, 10) } : null;
}

/* A failed `gh` as an error a client can tell apart. Never reads a token: gh holds the login. */
export function ghError(result: GitResult, notFound: 'issue-not-found' | 'pr-not-found' = 'issue-not-found'): GitError {
    const text = result.stderr.trim();
    if (result.code === 128 && /could not be started/.test(text)) {
        return new GitError('gh-missing', 'The GitHub CLI (gh) is not installed on this machine.');
    }
    if (/gh auth login|not logged in|authentication required|HTTP 401/i.test(text)) {
        return new GitError('gh-unauthenticated', 'gh is not signed in on this machine. Run `gh auth login` there.');
    }
    if (/could not resolve to an? (issue|pull ?request)|HTTP 404|no pull requests? found|not found/i.test(text)) {
        return new GitError(notFound, notFound === 'issue-not-found' ? 'That issue was not found.' : 'No pull request was found.');
    }
    return new GitError('gh-failed', text === '' ? 'gh failed' : text);
}

/* The output of a `gh` that succeeded; every other outcome is an error from `ghError`. */
export async function ghOutput(run: GhRunner, args: string[], cwd: string, notFound?: 'issue-not-found' | 'pr-not-found'): Promise<string> {
    const result = await run(args, cwd);
    if (result.code !== 0) {
        throw ghError(result, notFound);
    }
    return result.stdout;
}

/* `owner/repo` of the repository a folder is in, as gh sees its remotes. */
export async function repoOf(run: GhRunner, cwd: string): Promise<string> {
    const output = await ghOutput(run, ['repo', 'view', '--json', 'nameWithOwner'], cwd);
    const name = (JSON.parse(output) as { nameWithOwner?: unknown }).nameWithOwner;
    if (typeof name !== 'string' || name === '') {
        throw new GitError('gh-failed', 'gh did not say which repository this folder belongs to.');
    }
    return name;
}

interface IssueJson {
    number?: number;
    title?: string;
    body?: string | null;
    url?: string;
    state?: string;
    author?: { login?: string } | null;
    labels?: Array<{ name?: string }>;
}

/* An issue with its body, from the repository the reference names or, for `#12`, the one the folder is in. */
export async function readIssue(run: GhRunner, cwd: string, ref: IssueRef): Promise<GitIssue> {
    const repo = ref.repo ?? (await repoOf(run, cwd));
    const output = await ghOutput(run, ['issue', 'view', String(ref.number), '--repo', repo, '--json', 'number,title,body,url,state,author,labels'], cwd);
    let issue: IssueJson;
    try {
        issue = JSON.parse(output) as IssueJson;
    } catch {
        throw new GitError('gh-failed', 'gh answered something that is not an issue.');
    }
    return {
        repo,
        number: issue.number ?? ref.number,
        title: issue.title ?? '',
        body: (issue.body ?? '').slice(0, MAX_BODY),
        url: issue.url ?? `https://github.com/${repo}/issues/${ref.number}`,
        state: issue.state ?? 'OPEN',
        author: issue.author?.login ?? null,
        labels: (issue.labels ?? []).map((label) => label.name ?? '').filter((name) => name !== '')
    };
}
