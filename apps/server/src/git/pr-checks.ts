import type { GitPrCheck, GitPrCheckState } from '@ruimte/contracts';

/* One entry of a commit's check rollup as GraphQL spells it: a check run, or a status from an older integration. */
export interface RawCheck {
    __typename?: string;
    name?: string;
    status?: string;
    conclusion?: string | null;
    detailsUrl?: string | null;
    checkSuite?: { app?: { slug?: string } | null; workflowRun?: { event?: string; workflow?: { name?: string } | null } | null } | null;
    context?: string;
    state?: string;
    targetUrl?: string | null;
}

export type CheckSummary = 'pending' | 'success' | 'failure' | 'none';

/* The push run and the pull request run of one workflow carry the same name, so the name alone is no identity. */
export function checkKey(kind: string, app: string, workflow: string, event: string, name: string): string {
    return [kind, app, workflow, event, name].join('|');
}

function runState(raw: RawCheck): GitPrCheckState {
    if (raw.status !== 'COMPLETED') {
        return 'pending';
    }
    const conclusion = raw.conclusion ?? '';
    if (conclusion === 'SUCCESS') {
        return 'success';
    }
    if (conclusion === 'NEUTRAL') {
        return 'neutral';
    }
    if (conclusion === 'SKIPPED') {
        return 'skipped';
    }
    // FAILURE, CANCELLED, TIMED_OUT, ACTION_REQUIRED and whatever GitHub adds later: never green on a conclusion this does not know.
    return 'failure';
}

function statusState(state: string | undefined): GitPrCheckState {
    if (state === 'SUCCESS') {
        return 'success';
    }
    return state === 'FAILURE' || state === 'ERROR' ? 'failure' : 'pending';
}

/* A rollup entry as one check; an entry of a kind this does not know is dropped. */
export function toCheck(raw: RawCheck): GitPrCheck | null {
    if (raw.__typename === 'CheckRun') {
        const app = raw.checkSuite?.app?.slug ?? '';
        const workflow = raw.checkSuite?.workflowRun?.workflow?.name ?? '';
        const event = raw.checkSuite?.workflowRun?.event ?? '';
        const name = raw.name ?? '';
        return {
            key: checkKey('run', app, workflow, event, name),
            name,
            ...(workflow === '' ? {} : { workflow }),
            ...(event === '' ? {} : { event }),
            state: runState(raw),
            ...(raw.detailsUrl ? { url: raw.detailsUrl } : {})
        };
    }
    if (raw.__typename === 'StatusContext') {
        const name = raw.context ?? '';
        return { key: checkKey('status', '', '', '', name), name, state: statusState(raw.state), ...(raw.targetUrl ? { url: raw.targetUrl } : {}) };
    }
    return null;
}

/* Every check once, the last of a key winning, in the order they came. */
export function checksOf(raws: readonly RawCheck[]): GitPrCheck[] {
    const byKey = new Map<string, GitPrCheck>();
    for (const raw of raws) {
        const check = toCheck(raw);
        if (check !== null) {
            byKey.set(check.key, check);
        }
    }
    return [...byKey.values()];
}

/* A failure is a failure even while other checks still run, so the pull request is never green with one failing. */
export function summarizeChecks(checks: readonly GitPrCheck[]): CheckSummary {
    if (checks.length === 0) {
        return 'none';
    }
    if (checks.some((check) => check.state === 'failure')) {
        return 'failure';
    }
    return checks.some((check) => check.state === 'pending') ? 'pending' : 'success';
}

/* Whether every check of the commit has finished, which is when a watch has something to say. */
export function isTerminal(checks: readonly GitPrCheck[]): boolean {
    return checks.length > 0 && !checks.some((check) => check.state === 'pending');
}
