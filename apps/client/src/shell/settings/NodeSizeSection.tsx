import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Scaling } from 'lucide-react';
import { NODE_SIZE, NodeKindSchema, type NodeKind, type NodeSizes } from '@ruimte/contracts';
import { Button, DisabledReason } from '@adecore/ui';
import { useFormatLocale } from '@adecore/ui/format';
import { SettingsRow, TopIcon } from '@adecore/ui/settings';
import { formatNodeSize, resetDefaultSize } from '@/canvas/default-size';
import { NODE_KIND_ICONS } from '@/canvas/node-icons';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { LOCAL_ENDPOINT_ID, useEndpoints, type Endpoint } from '@/state/endpoints';
import { listedEndpoints } from '@/state/local-machine';
import { keepsNodeSizes } from '@/state/node-size';
import { useServers } from '@/state/server';
import { useEndpointConnection } from '@/transport/status';

/* The search lands on the first row of the first machine that keeps sizes, whatever that row is. */
const SEARCH_ID = 'views.nodeSizes';

function NodeSizeSection({ endpoint, sizes, searchId }: { endpoint: Endpoint; sizes: NodeSizes; searchId?: string }) {
    const { t } = useTranslation('settings');
    const connection = useEndpointConnection(endpoint.id);
    const connected = connection.status === 'open';
    const [resetting, setResetting] = useState<NodeKind | null>(null);
    const kinds = NodeKindSchema.options.filter((kind) => sizes[kind] !== undefined);

    const reset = async (kind: NodeKind): Promise<void> => {
        setResetting(kind);
        try {
            await resetDefaultSize(endpoint.id, kind);
        } finally {
            setResetting(null);
        }
    };

    return (
        <SettingsSection
            title={t('views.nodeSizes.title', { machine: endpoint.label })}
            description={t('views.nodeSizes.description')}
            icon={Scaling}
            scope="machine"
        >
            {kinds.length === 0 && <SettingsRow searchId={searchId} muted label={t('views.nodeSizes.empty')} />}
            {kinds.map((kind, index) => {
                const name = t(`shell:nodeKinds.${kind}`);
                return (
                    <SettingsRow
                        key={kind}
                        searchId={index === 0 ? searchId : undefined}
                        leading={<TopIcon icon={NODE_KIND_ICONS[kind]} size={20} className="text-text-muted" />}
                        label={name}
                        description={t('views.nodeSizes.size', { size: formatNodeSize(sizes[kind]!), builtIn: formatNodeSize(NODE_SIZE[kind]) })}
                        control={
                            <DisabledReason reason={connected ? null : t('machine.notAnswering')}>
                                <Button
                                    disabled={resetting !== null || !connected}
                                    aria-label={t('views.nodeSizes.resetLabel', { kind: name, machine: endpoint.label })}
                                    onClick={() => void reset(kind)}
                                >
                                    {t('views.nodeSizes.reset')}
                                </Button>
                            </DisabledReason>
                        }
                    />
                );
            })}
        </SettingsSection>
    );
}

/*
 * A section per machine that keeps sizes, listing only the kinds a person gave one. Setting a size
 * happens on a node, where its frame is the size; here is only the way back.
 */
export function NodeSizeSections() {
    useFormatLocale();
    const stored = useEndpoints((s) => s.endpoints);
    const endpoints = useMemo(() => listedEndpoints(stored), [stored]);
    // Nothing here holds a link, so a section reads what a connected machine last said.
    const servers = useServers((s) => s.byEndpoint);
    const keeping = [
        ...endpoints.filter((endpoint) => endpoint.id === LOCAL_ENDPOINT_ID),
        ...endpoints.filter((endpoint) => endpoint.id !== LOCAL_ENDPOINT_ID)
    ].filter((endpoint) => servers[endpoint.id] !== undefined && keepsNodeSizes(servers[endpoint.id]!));

    return (
        <>
            {keeping.map((endpoint, index) => (
                <NodeSizeSection key={endpoint.id} endpoint={endpoint} sizes={servers[endpoint.id]!.nodeSizes} searchId={index === 0 ? SEARCH_ID : undefined} />
            ))}
        </>
    );
}
