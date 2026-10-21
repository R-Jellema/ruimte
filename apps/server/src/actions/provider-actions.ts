import { registryAgentMatches } from '@ruimte/contracts';
import type { ActionHandlers } from '@ruimte/actions';
import { VerbRefusal, type ProviderInstallHost } from '../canvas/verb.ts';
import type { ServerActionContext } from './context.ts';

function installsOf(context: ServerActionContext): ProviderInstallHost {
    if (!context.host.providerInstalls) {
        throw new VerbRefusal('no-providers', 'This machine keeps no agent CLIs');
    }
    return context.host.providerInstalls;
}

export const providerActions: ActionHandlers<ServerActionContext> = {
    'provider.catalog': async ({ search, refresh }, { context }) => {
        const catalog = await installsOf(context).catalog(refresh === true);
        return { output: search == null ? catalog : { ...catalog, agents: catalog.agents.filter((agent) => registryAgentMatches(agent, search)) } };
    },
    'provider.versions': async ({ refresh }, { context }) => ({
        output: { versions: await installsOf(context).versions(refresh === true) }
    })
};
