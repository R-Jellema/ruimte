import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { USAGE_VERB_COUNTERS } from '@ruimte/pulsar';
import { VERBS } from '../canvas/verbs.ts';
import { UsageCounter } from './usage-counter.ts';
import { countClient, countProjectOpened, countRequest, countUsage, countVerb, countViewShown, installUsageCounter } from './usage-stats.ts';

let counter: UsageCounter;
let on: boolean;
let clock: number;

function counts(): Record<string, number> {
    clock += 86_400_000;
    return counter.finished()[0]?.counts ?? {};
}

beforeEach(() => {
    clock = Date.parse('2026-10-14T10:00:00Z');
    on = true;
    counter = new UsageCounter({
        store: { read: async () => null, write: async () => undefined },
        describe: () => ({ version: '1.2.3', launcher: 'desktop' }),
        now: () => clock,
        schedule: () => () => undefined
    });
    installUsageCounter(counter, () => on);
});

afterEach(() => {
    installUsageCounter(null);
});

describe('counting at the sites', () => {
    test('counts nothing while the switch is off or no counter is installed', () => {
        on = false;
        countUsage('projectsOpened');
        installUsageCounter(null);
        countUsage('projectsOpened');
        expect(counts()).toEqual({});
    });

    test('every verb of ruimte-context counts in its group', () => {
        for (const verb of VERBS) {
            expect(Object.keys(USAGE_VERB_COUNTERS)).toContain(verb.name);
        }
    });

    test('a verb counts in its group, and delegating and feature verbs on the day as well', () => {
        countVerb('agent');
        countVerb('team');
        countVerb('browser');
        countVerb('read');
        countVerb('no-such-verb');
        expect(counts()).toEqual({ verbsAgent: 2, agentsDelegated: 1, teamsDelegated: 1, verbsBrowser: 1, browserActions: 1, verbsRead: 1 });
    });

    test('a request counts only when it is an action a person takes', () => {
        countRequest('device.action');
        countRequest('project.list');
        expect(counts()).toEqual({ deviceActions: 1 });
    });

    test('a project counts once a day, however often clients open it again', () => {
        countProjectOpened('p1');
        countProjectOpened('p1');
        countProjectOpened('p2');
        expect(counts()).toEqual({ projectsOpened: 2 });
        countProjectOpened('p1');
        expect(counts()).toEqual({ projectsOpened: 1 });
    });

    test('a client from elsewhere counts once a day by the session its key proved, by the kind it names', () => {
        const desktop = { reachability: 'tunnel', sessionId: 's1' } as const;
        countClient(desktop, 'desktop');
        // The same app after a reconnect, on a new socket.
        countClient({ ...desktop }, 'desktop');
        countClient({ reachability: 'tunnel', sessionId: 's2' }, 'ios');
        countClient({ reachability: 'tunnel', sessionId: 's5' }, 'ios');
        countClient({ reachability: 'tunnel', sessionId: 's3', peer: { machineId: 'm' } }, undefined);
        countClient({ reachability: 'lan', sessionId: 's3', peer: { machineId: 'm' } }, undefined);
        countClient({ reachability: 'loopback', sessionId: null }, 'desktop');
        countClient({ reachability: 'tunnel', sessionId: 's4' }, 'toaster');
        countClient(undefined, 'desktop');
        expect(counts()).toEqual({ clientsDesktop: 1, clientsIos: 2, clientsPeer: 1 });
        countClient(desktop, 'desktop');
        expect(counts()).toEqual({ clientsDesktop: 1 });
    });

    test('each view of a project counts once a day, by its kind', () => {
        const kinds: Record<string, string> = { canvas: 'canvas', notes: 'file', line: 'separator' };
        const kindOf = (viewId: string): string | null => kinds[viewId] ?? null;
        countViewShown('p1', 'canvas', kindOf);
        countViewShown('p1', 'canvas', kindOf);
        countViewShown('p1', 'notes', kindOf);
        countViewShown('p1', null, kindOf);
        countViewShown('p1', 'canvas', kindOf);
        countViewShown('p1', 'line', kindOf);
        countViewShown('p2', 'canvas', kindOf);
        expect(counts()).toEqual({ viewsCanvas: 2, viewsFile: 1 });
        countViewShown('p1', 'canvas', kindOf);
        expect(counts()).toEqual({ viewsCanvas: 1 });
    });
});
