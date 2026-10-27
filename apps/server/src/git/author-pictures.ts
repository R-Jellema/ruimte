import type { GitAuthorsResult } from '@ruimte/contracts';
import { ghOutput, runGh, type GhRunner } from './github.ts';

// Authors change rarely; a log that reloads on every status should not ask GitHub each time.
const KEPT_MS = 60 * 60_000;

// gh fills `{owner}/{repo}` from the folder's remotes, so a repository not on GitHub fails here and keeps no pictures.
const COMMITS = [
    'api',
    'repos/{owner}/{repo}/commits?per_page=100',
    '--jq',
    '[.[] | select(.author.id != null) | {email: .commit.author.email, id: .author.id}]'
];

type Author = GitAuthorsResult['authors'][number];

/*
 * Which GitHub account wrote with which address, as GitHub linked the repository's last hundred commits.
 * Only the repository's own name goes to GitHub, which already holds those commits; an address never does.
 */
export async function readAuthors(run: GhRunner, cwd: string): Promise<Author[]> {
    const parsed: unknown = JSON.parse(await ghOutput(run, COMMITS, cwd));
    const authors = new Map<string, number>();

    if (!Array.isArray(parsed)) {
        return [];
    }

    for (const entry of parsed as Array<{ email?: unknown; id?: unknown }>) {
        if (typeof entry.email === 'string' && entry.email !== '' && Number.isSafeInteger(entry.id) && (entry.id as number) > 0) {
            authors.set(entry.email.toLowerCase(), entry.id as number);
        }
    }

    return [...authors].map(([email, id]) => ({ email, id }));
}

/* The authors per folder, read at most once an hour. A read that failed keeps its empty answer just as long, so a folder off GitHub costs one gh. */
export class AuthorPictures {
    private readonly known = new Map<string, { at: number; authors: Promise<Author[]> }>();
    private readonly run: GhRunner;
    private readonly now: () => number;

    constructor(run: GhRunner = runGh, now: () => number = Date.now) {
        this.run = run;
        this.now = now;
    }

    authorsOf(cwd: string): Promise<Author[]> {
        const kept = this.known.get(cwd);

        if (kept !== undefined && this.now() - kept.at < KEPT_MS) {
            return kept.authors;
        }

        const authors = readAuthors(this.run, cwd).catch(() => []);
        this.known.set(cwd, { at: this.now(), authors });

        return authors;
    }
}

export const authorPictures = new AuthorPictures();
