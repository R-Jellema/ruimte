import type { ProviderInfo } from '@ruimte/contracts';
import { ProvidersPane as Pane } from '@adecore/agents-react/providers';
import { AcpServerSection } from '@/shell/settings/providers/AcpServerSection';
import { AppleFoundationSection } from '@/shell/settings/providers/AppleFoundationSection';
import { useEndpointId } from '@/state/keys';
import { useUi } from '@/state/ui';
import { useDetectProviders } from '@/transport/provider-detection';

/* The providers of the machine in scope, with the model that machine runs on its own drawn by Ruimte. */
export function ProvidersPane() {
    const endpointId = useEndpointId();
    const target = useUi((s) => s.settings.target);
    useDetectProviders();
    const detailOf = (provider: ProviderInfo) => {
        if (provider.kind === 'apple') {
            return <AppleFoundationSection endpointId={endpointId} provider={provider} />;
        }
        return provider.kind === 'antigravity' ? <AcpServerSection endpointId={endpointId} provider={provider} /> : null;
    };
    return <Pane target={target} detailOf={detailOf} />;
}
