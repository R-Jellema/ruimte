import { USAGE_CLIENT_KINDS, type UsageClientKind } from '@ruimte/contracts';
import {
    USAGE_VERB_COUNTERS,
    USAGE_VIEW_COUNTERS,
    usageModeOf,
    usageModelFamilyOf,
    usageProviderOf,
    type UsageReportCounter,
    type UsageReportTiming
} from '@ruimte/pulsar';
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

export function countUsage(counter: UsageReportCounter): void {
    if (installed !== null && enabled()) {
        installed.count(counter);
    }
}

function countUsageOnce(counter: UsageReportCounter, key: string): void {
    if (installed !== null && enabled()) {
        installed.countOnce(counter, key);
    }
}

export function recordStartup(ms: number): void {
    if (installed !== null && enabled()) {
        installed.startup(ms);
    }
}

/* One sample of a timing, in milliseconds; the day sends their median. */
export function recordTiming(timing: UsageReportTiming, ms: number): void {
    if (installed !== null && enabled() && Number.isFinite(ms) && ms >= 0) {
        installed.sample(timing, Math.round(ms));
    }
}

// What a person asks over the wire that counts as an action, beside what agents do through their verbs.
const REQUEST_COUNTERS: Readonly<Record<string, UsageReportCounter>> = {
    'browser.navigate': 'actions.browser',
    'browser.command': 'actions.browser',
    'device.boot': 'actions.device',
    'device.shutdown': 'actions.device',
    'device.action': 'actions.device',
    'device.capture': 'actions.device',
    'device.record': 'actions.device',
    'device.clipboard': 'actions.device',
    'database.request': 'actions.database',
    'computer.control': 'actions.computer'
};

// The verbs that also count on the day itself: what an agent delegates, and what it does in a feature a person can use too.
const VERB_DAY_COUNTERS: Readonly<Record<string, UsageReportCounter>> = {
    agent: 'agents.delegated',
    team: 'teams.delegated',
    browser: 'actions.browser',
    device: 'actions.device',
    database: 'actions.database',
    computer: 'actions.computer'
};

const VERBS: ReadonlySet<string> = new Set(Object.keys(USAGE_VERB_COUNTERS));
const VIEW_KINDS: ReadonlySet<string> = new Set(Object.keys(USAGE_VIEW_COUNTERS));

/* A request that was answered. */
export function countRequest(type: string): void {
    const counter = REQUEST_COUNTERS[type];
    if (counter !== undefined) {
        countUsage(counter);
    }
}

/* A `ruimte-context` verb that ran. */
export function countVerb(name: string): void {
    if (VERBS.has(name)) {
        countUsage(`verbs.${name}` as UsageReportCounter);
    }
    const day = VERB_DAY_COUNTERS[name];
    if (day !== undefined) {
        countUsage(day);
    }
}

export function countChatStarted(provider: string): void {
    countUsage(`chats.${usageProviderOf(provider)}`);
}

/* A turn a chat started: by provider, by the family of its model when it named one, and by the mode it ran in. */
export function countTurn(provider: string, model?: string | null, mode?: string | null): void {
    countUsage(`turns.${usageProviderOf(provider)}`);
    if (model) {
        countUsage(`turns.model.${usageModelFamilyOf(model)}`);
    }
    const counted = mode ? usageModeOf(mode) : null;
    if (counted !== null) {
        countUsage(`turns.mode.${counted}`);
    }
}

/* A turn that stopped on a usage limit of its provider. */
export function countLimit(provider: string): void {
    countUsage(`limits.${usageProviderOf(provider)}`);
}

/* The time from a turn's start to its first words, per provider. */
export function recordFirstToken(provider: string, ms: number): void {
    recordTiming(`firstTokenMs.${usageProviderOf(provider)}`, ms);
}

function isClientKind(kind: string): kind is UsageClientKind {
    return (USAGE_CLIENT_KINDS as readonly string[]).includes(kind);
}

/*
 * A client that came in from elsewhere, once per UTC day by the session its key proved, so a reconnect
 * does not count again: a machine working here as a peer, or an app that named itself. The app on this
 * machine, on the local secret, is not a remote client.
 */
export function countClient(access: ClientAccess | undefined, kind: string | undefined): void {
    if (access === undefined || isOwner(access)) {
        return;
    }
    if (access.peer !== undefined) {
        countUsageOnce('clients.peer', access.peer.machineId);
        return;
    }
    if (kind !== undefined && isClientKind(kind) && access.sessionId !== null) {
        countUsageOnce(`clients.${kind}`, access.sessionId);
    }
}

/* A project a client opened, once per UTC day, so the open a client repeats after a reconnect does not count again. */
export function countProjectOpened(projectId: string): void {
    countUsageOnce('projects.opened', projectId);
}

/*
 * A view a client put on screen, told by the active view of its local state: each view of a project
 * counts once per UTC day, however often a client comes back to it or saves its camera.
 */
export function countViewShown(projectId: string, viewId: string | null, kindOf: (viewId: string) => string | null): void {
    if (viewId === null) {
        return;
    }
    const kind = kindOf(viewId);
    if (kind !== null && VIEW_KINDS.has(kind)) {
        countUsageOnce(`views.${kind}` as UsageReportCounter, `${projectId}\n${viewId}`);
    }
}
