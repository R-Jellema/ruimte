import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { USAGE_VERB_COUNTERS } from '@ruimte/pulsar';
import { VERBS } from '../canvas/verbs.ts';
import { UsageCounter } from './usage-counter.ts';
import { countClient, countRequest, countUsage, countVerb, countViewShown, installUsageCounter } from './usage-stats.ts';

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
        countRequest('project.open');
        countRequest('device.action');
        countRequest('project.list');
        expect(counts()).toEqual({ projectsOpened: 1, deviceActions: 1 });
    });

    test('a client from elsewhere counts once per connection, by the kind it names', () => {
        const desktop = {};
        const phone = {};
        const peer = {};
        const owner = {};
        countClient(desktop, { reachability: 'tunnel', sessionId: 's1' }, 'desktop');
        countClient(desktop, { reachability: 'tunnel', sessionId: 's1' }, 'desktop');
        countClient(phone, { reachability: 'tunnel', sessionId: 's2' }, 'ios');
        countClient(peer, { reachability: 'tunnel', sessionId: 's3', peer: { machineId: 'm' } }, undefined);
        countClient(owner, { reachability: 'loopback', sessionId: null }, 'desktop');
        countClient({}, { reachability: 'tunnel', sessionId: 's4' }, 'toaster');
        expect(counts()).toEqual({ clientsDesktop: 1, clientsIos: 1, clientsPeer: 1 });
    });

    test('a view counts when it becomes the one a client looks at', () => {
        const client = {};
        const kinds: Record<string, string> = { canvas: 'canvas', notes: 'file', line: 'separator' };
        const kindOf = (viewId: string): string | null => kinds[viewId] ?? null;
        countViewShown(client, 'p1', 'canvas', kindOf);
        countViewShown(client, 'p1', 'canvas', kindOf);
        countViewShown(client, 'p1', 'notes', kindOf);
        countViewShown(client, 'p1', null, kindOf);
        countViewShown(client, 'p1', 'canvas', kindOf);
        countViewShown(client, 'p1', 'line', kindOf);
        countViewShown({}, 'p1', 'notes', kindOf);
        expect(counts()).toEqual({ viewsCanvas: 2, viewsFile: 2 });
    });
});
