import type { AgentKind } from '@ruimte/contracts';
import { ProviderAccountsService } from '@adecore/agents/providers';
import { AgentIntegrations } from '../agents/integrations.ts';
import type { EndpointIdentity } from '../endpoint-id.ts';
import { RUIMTE_ACCOUNTS_HOST } from '../providers/accounts-host.ts';
import { RUIMTE_CODEX_CLIENT } from '../providers/codex-provider.ts';
import { ModelCatalogFeed } from '../providers/model-catalogs.ts';
import { ProviderRegistry } from '../providers/registry.ts';
import type { ServerConfig } from '../config.ts';

/* The agent CLIs of this machine, their accounts and what a person allowed in their settings. */
export interface ProvidersBundle {
    providers: ProviderRegistry;
    modelCatalogs: ModelCatalogFeed;
    integrations: AgentIntegrations;
    accounts: ProviderAccountsService;
    nameOfCli(kind: AgentKind): string;
}

/*
 * `alongside` loads beside the providers' own files, so neither waits on the other. `fetched` runs
 * wherever the model catalogs may be fetched, for the usage counts that go out at the same moments.
 */
export async function wireProviders(
    config: ServerConfig,
    identity: EndpointIdentity,
    alongside: () => Promise<void>,
    fetched: () => void = () => undefined
): Promise<ProvidersBundle> {
    const providers = new ProviderRegistry({
        appleEnabled: () => identity.appleFoundationEnabled,
        onList: () => {
            void modelCatalogs.refresh();
            fetched();
        }
    });
    const modelCatalogs = new ModelCatalogFeed({
        home: config.home,
        allowFetch: config.modelFetch,
        catalogs: Object.fromEntries((['claude', 'codex', 'copilot', 'grok'] as const).map((kind) => [kind, providers.catalogFor(kind)]))
    });
    // What a person allowed in the CLIs' global settings; the accounts below ask it before they write anywhere.
    const integrations = new AgentIntegrations({
        home: config.home,
        fixed: !config.installHooks,
        accountHomes: (kind) =>
            Object.entries(accounts.snapshot().accounts)
                .filter(([id, account]) => account.kind === kind && id !== kind && account.home !== undefined)
                .map(([, account]) => account.home!)
    });
    await Promise.all([integrations.load(), modelCatalogs.load(), alongside()]);
    void modelCatalogs.refresh();
    fetched();
    identity.attachAgentIntegrations({ describe: () => ({ agentIntegrations: integrations.summary() }) });
    integrations.onChanged(() => identity.announce());
    // Before the managers, which start every CLI under the account its node or chat names.
    const accounts = new ProviderAccountsService({
        home: config.home,
        host: RUIMTE_ACCOUNTS_HOST,
        client: RUIMTE_CODEX_CLIENT,
        providers,
        install: (kind, folder) => integrations.installFolder(kind, folder)
    });
    await accounts.load();
    return { providers, modelCatalogs, integrations, accounts, nameOfCli: (kind) => providers.get(kind).name };
}
