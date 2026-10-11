import { describe, expect, test } from 'bun:test';
import { checksOf, isTerminal, summarizeChecks, toCheck, type RawCheck } from './pr-checks.ts';

function run(name: string, event: string, status: string, conclusion: string | null = null): RawCheck {
    return {
        __typename: 'CheckRun',
        name,
        status,
        conclusion,
        checkSuite: { app: { slug: 'github-actions' }, workflowRun: { event, workflow: { name: 'CI' } } }
    };
}

describe('checks', () => {
    test('the push run and the pull request run of one name stay apart', () => {
        const checks = checksOf([run('test', 'push', 'COMPLETED', 'FAILURE'), run('test', 'pull_request', 'COMPLETED', 'SUCCESS')]);
        expect(checks).toHaveLength(2);
        expect(checks.map((check) => check.state)).toEqual(['failure', 'success']);
        expect(new Set(checks.map((check) => check.key)).size).toBe(2);
    });

    test('a failure beside a pending check is a failure that is not terminal yet', () => {
        const checks = checksOf([run('lint', 'pull_request', 'COMPLETED', 'FAILURE'), run('test', 'pull_request', 'IN_PROGRESS')]);
        expect(summarizeChecks(checks)).toBe('failure');
        expect(isTerminal(checks)).toBe(false);
    });

    test('cancelled, timed out and action required are failures; skipped and neutral are not', () => {
        for (const conclusion of ['CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED']) {
            expect(toCheck(run('x', 'push', 'COMPLETED', conclusion))?.state).toBe('failure');
        }
        expect(summarizeChecks(checksOf([run('a', 'push', 'COMPLETED', 'SKIPPED'), run('b', 'push', 'COMPLETED', 'NEUTRAL')]))).toBe('success');
    });

    test('a status context maps its state', () => {
        const states = ['SUCCESS', 'FAILURE', 'ERROR', 'PENDING', 'EXPECTED'].map(
            (state) => toCheck({ __typename: 'StatusContext', context: 'ci/x', state })?.state
        );
        expect(states).toEqual(['success', 'failure', 'failure', 'pending', 'pending']);
    });

    test('no checks is none, and nothing is terminal about it', () => {
        expect(summarizeChecks([])).toBe('none');
        expect(isTerminal([])).toBe(false);
    });
});
