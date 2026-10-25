import { FRONTIER_PROVIDER_KINDS, groupProvidersByFrontier, type AgentKind, type ProviderInfo } from '@ruimte/contracts';
import type { AgentTarget } from './nodes';

/* The providers in the order a picker lists them; a machine older than that order sends them in its own. */
export function inPickerOrder<T extends { kind: AgentKind; name: string }>(providers: readonly T[]): T[] {
    const groups = groupProvidersByFrontier(providers);
    return [...groups.frontier, ...groups.others];
}

/* Whether a picker draws a separator between two providers next to each other: where the frontier labs end. */
export function separatesFrontier(previous: AgentKind | undefined, kind: AgentKind): boolean {
    return previous !== undefined && FRONTIER_PROVIDER_KINDS.has(previous) && !FRONTIER_PROVIDER_KINDS.has(kind);
}

export function availableAgents(providers: readonly ProviderInfo[], target: AgentTarget): ProviderInfo[] {
    return inPickerOrder(providers.filter((provider) => provider.installed && provider.capabilities[target]));
}
