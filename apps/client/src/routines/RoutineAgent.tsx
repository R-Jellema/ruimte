import type { AgentKind } from '@ruimte/contracts';
import { AgentIcon, modelName, ProviderLogo } from '@adecore/agents-react/providers';
import { useProvidersStore } from '@adecore/agents-react/state';
import { hasProviderLogo } from '@/agents/provider-logo';

/* The agent a routine starts, by its CLI's mark and the model it picked, as Output names who made a version. */
export function RoutineAgent({
    endpointId,
    provider,
    model,
    size = 14
}: {
    endpointId: string;
    provider: AgentKind;
    model: string | undefined;
    size?: number;
}) {
    const catalog = useProvidersStore((s) => s.byScope[endpointId]?.providers.find((entry) => entry.kind === provider));
    const name = model === undefined ? (catalog?.name ?? provider) : modelName(model, catalog?.models);
    return (
        <span className="flex min-w-0 items-center gap-1.5">
            {hasProviderLogo(provider) ? <ProviderLogo provider={provider} size={size} /> : <AgentIcon kind={provider} size={size} className="shrink-0" />}
            <span className="truncate">{name}</span>
        </span>
    );
}
