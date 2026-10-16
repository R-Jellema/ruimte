import { USAGE_CLIENT_KINDS, type AgentKind, type UsageClientKind } from '@ruimte/contracts';
import { USAGE_CHAT_COUNTERS, USAGE_VERB_COUNTERS, USAGE_VIEW_COUNTERS, type UsageCounter as UsageCounterName } from '@ruimte/pulsar';
import { isOwner } from '../auth/access.ts';
import type { ClientAccess } from '../dispatcher.ts';
import type { UsageCounter } from './usage-counter.ts';

/*
 * Where every site of the daemon counts, with one call each. Nothing counts until the release build
 * installs a counter, and nothing while a person has the switch off; a call is then one integer.
 */

let installed: UsageCounter | null = null;
let enabled: () => boolean = () => false;

export function installUsageCounter(counter: UsageCounter | null, on: () => boolean = () => counter !== null): void {
    installed = counter;
    enabled = on;
}

export function countUsage(counter: UsageCounterName): void {
    if (installed !== null && enabled()) {
        installed.count(counter);
    }
}

export function recordStartup(ms: number): void {
    if (installed !== null && enabled()) {
        installed.startup(ms);
    }
}

// What a person asks over the wire that counts as an action, beside what agents do through their verbs.
const REQUEST_COUNTERS: Readonly<Record<string, UsageCounterName>> = {
    'project.open': 'projectsOpened',
    'browser.navigate': 'browserActions',
    'browser.command': 'browserActions',
    'device.boot': 'deviceActions',
    'device.shutdown': 'deviceActions',
    'device.action': 'deviceActions',
    'device.capture': 'deviceActions',
    'device.record': 'deviceActions',
    'device.clipboard': 'deviceActions',
    'database.request': 'databaseActions',
    'computer.control': 'computerActions'
};

// The verbs that also count on the day itself: what an agent delegates, and what it does in a feature a person can use too.
const VERB_DAY_COUNTERS: Readonly<Record<string, UsageCounterName>> = {
    agent: 'agentsDelegated',
    team: 'teamsDelegated',
    browser: 'browserActions',
    device: 'deviceActions',
    database: 'databaseActions',
    computer: 'computerActions'
};

const CLIENT_COUNTERS: Readonly<Record<UsageClientKind, UsageCounterName>> = {
    desktop: 'clientsDesktop',
    ios: 'clientsIos',
    station: 'clientsStation'
};

/* A request that was answered. */
export function countRequest(type: string): void {
    const counter = REQUEST_COUNTERS[type];
    if (counter !== undefined) {
        countUsage(counter);
    }
}

/* A `ruimte-context` verb that ran. */
export function countVerb(name: string): void {
    const group = (USAGE_VERB_COUNTERS as Readonly<Record<string, UsageCounterName>>)[name];
    if (group !== undefined) {
        countUsage(group);
    }
    const day = VERB_DAY_COUNTERS[name];
    if (day !== undefined) {
        countUsage(day);
    }
}

export function countChatStarted(provider: AgentKind): void {
    countUsage(USAGE_CHAT_COUNTERS[provider].chats);
}

export function countTurn(provider: AgentKind): void {
    countUsage(USAGE_CHAT_COUNTERS[provider].turns);
}

function isClientKind(kind: string): kind is UsageClientKind {
    return (USAGE_CLIENT_KINDS as readonly string[]).includes(kind);
}

const countedClients = new WeakSet<object>();

/*
 * A client that came in from elsewhere, once per connection: a machine working here as a peer, or an
 * app that named itself. The app on this machine, on the local secret, is not a remote client.
 */
export function countClient(connection: object, access: ClientAccess | undefined, kind: string | undefined): void {
    if (countedClients.has(connection)) {
        return;
    }
    if (access?.peer !== undefined) {
        countedClients.add(connection);
        countUsage('clientsPeer');
        return;
    }
    if (isOwner(access) || kind === undefined || !isClientKind(kind)) {
        return;
    }
    countedClients.add(connection);
    countUsage(CLIENT_COUNTERS[kind]);
}

const shownViews = new WeakMap<object, Map<string, string | null>>();

/*
 * A view a client put on screen, told by the active view of its local state: a view counts when it
 * becomes the one a client looks at, not on every save of the camera while it stays.
 */
export function countViewShown(connection: object, projectId: string, viewId: string | null, kindOf: (viewId: string) => string | null): void {
    let shown = shownViews.get(connection);
    if (shown === undefined) {
        shown = new Map();
        shownViews.set(connection, shown);
    }
    if (shown.get(projectId) === viewId) {
        return;
    }
    shown.set(projectId, viewId);
    if (viewId === null) {
        return;
    }
    const kind = kindOf(viewId);
    const counter = kind === null ? undefined : (USAGE_VIEW_COUNTERS as Readonly<Record<string, UsageCounterName>>)[kind];
    if (counter !== undefined) {
        countUsage(counter);
    }
}
