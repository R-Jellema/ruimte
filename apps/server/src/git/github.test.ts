import { describe, expect, test } from 'bun:test';
import { ghError, parseIssueRef, readIssue, type GhRunner } from './github.ts';

function fake(answers: Record<string, { code?: number; stdout?: string; stderr?: string }>): { run: GhRunner; calls: string[][] } {
    const calls: string[][] = [];
    const run: GhRunner = async (args) => {
        calls.push(args);
        const answer = answers[args.slice(0, 2).join(' ')];
        return { code: answer?.code ?? 0, stdout: answer?.stdout ?? '', stderr: answer?.stderr ?? '' };
    };
    return { run, calls };
}

const issue = {
    number: 12,
    title: 'It breaks',
    body: 'Steps',
    url: 'https://github.com/o/r/issues/12',
    state: 'OPEN',
    author: { login: 'ada' },
    labels: [{ name: 'bug' }]
};

describe('parseIssueRef', () => {
    test('reads a link, owner/repo#12 and #12', () => {
        expect(parseIssueRef('https://github.com/o/r/issues/12')).toEqual({ repo: 'o/r', number: 12 });
        expect(parseIssueRef('https://github.com/o/r/issues/12#issuecomment-5')).toEqual({ repo: 'o/r', number: 12 });
        expect(parseIssueRef(' o/r#12 ')).toEqual({ repo: 'o/r', number: 12 });
        expect(parseIssueRef('#12')).toEqual({ repo: null, number: 12 });
    });

    test('refuses everything else', () => {
        expect(parseIssueRef('12')).toBeNull();
        expect(parseIssueRef('https://example.com/o/r/issues/12')).toBeNull();
        expect(parseIssueRef('o/r#')).toBeNull();
    });
});

describe('ghError', () => {
    test('tells a missing gh, a missing login and a missing issue apart', () => {
        expect(ghError({ code: 128, stdout: '', stderr: 'gh could not be started' }).code).toBe('gh-missing');
        expect(ghError({ code: 4, stdout: '', stderr: 'To get started with GitHub CLI, please run:  gh auth login' }).code).toBe('gh-unauthenticated');
        expect(ghError({ code: 1, stdout: '', stderr: 'GraphQL: Could not resolve to an issue or pull request with the number of 9.' }).code).toBe(
            'issue-not-found'
        );
        expect(ghError({ code: 1, stdout: '', stderr: 'boom' }).code).toBe('gh-failed');
    });
});

describe('readIssue', () => {
    test('reads an issue of the repository the reference names', async () => {
        const { run, calls } = fake({ 'issue view': { stdout: JSON.stringify(issue) } });
        expect(await readIssue(run, '/p', { repo: 'x/y', number: 12 })).toEqual({
            repo: 'x/y',
            number: 12,
            title: 'It breaks',
            body: 'Steps',
            url: 'https://github.com/o/r/issues/12',
            state: 'OPEN',
            author: 'ada',
            labels: ['bug']
        });
        expect(calls).toHaveLength(1);
        expect(calls[0]).toContain('x/y');
    });

    test('o/r#12 and x/y#12 read different repositories', async () => {
        const { run, calls } = fake({ 'issue view': { stdout: JSON.stringify(issue) } });
        await readIssue(run, '/p', { repo: 'o/r', number: 12 });
        await readIssue(run, '/p', { repo: 'x/y', number: 12 });
        expect(calls.map((args) => args[args.indexOf('--repo') + 1])).toEqual(['o/r', 'x/y']);
    });

    test('#12 asks gh which repository the folder is in first', async () => {
        const { run, calls } = fake({ 'repo view': { stdout: JSON.stringify({ nameWithOwner: 'me/mine' }) }, 'issue view': { stdout: JSON.stringify(issue) } });
        const read = await readIssue(run, '/p', { repo: null, number: 12 });
        expect(read.repo).toBe('me/mine');
        expect(calls.map((args) => args[0])).toEqual(['repo', 'issue']);
        expect(calls[1]).toContain('me/mine');
    });

    test('a failed gh is the error of its kind', async () => {
        const { run } = fake({ 'issue view': { code: 1, stderr: 'Could not resolve to an issue' } });
        await expect(readIssue(run, '/p', { repo: 'o/r', number: 1 })).rejects.toMatchObject({ code: 'issue-not-found' });
    });
});
