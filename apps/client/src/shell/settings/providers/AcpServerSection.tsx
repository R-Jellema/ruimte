import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentServerStatus, ProviderInfo } from '@ruimte/contracts';
import { useProvidersStore } from '@adecore/agents-react/state';
import { Button, Spinner } from '@adecore/ui';
import { SettingsRow } from '@adecore/ui/settings';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { transportFor } from '@/transport';
import { useMachineAnswers } from '@/transport/features';

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/*
 * The chat server of a CLI that ships one apart (Antigravity's), which a person installs on this machine.
 * Only the app on the machine itself may install it, since that downloads a program and makes it runnable there.
 */
export function AcpServerSection({ endpointId, provider }: { endpointId: string; provider: ProviderInfo }) {
    const { t } = useTranslation('settings');
    const answers = useMachineAnswers(endpointId, 'provider.server');
    const [server, setServer] = useState<AgentServerStatus | null>(null);
    const [error, setError] = useState<string | null>(null);
    const local = endpointId === LOCAL_ENDPOINT_ID;

    useEffect(() => {
        const link = transportFor(endpointId);
        if (!link || !answers) {
            return;
        }
        let live = true;
        link.request('provider.server', { provider: provider.kind }).then(
            (result) => {
                if (live) {
                    setServer(result.server);
                }
            },
            (e: unknown) => {
                if (live) {
                    setError(messageOf(e));
                }
            }
        );
        return () => {
            live = false;
        };
    }, [endpointId, answers, provider.kind]);

    async function install(): Promise<void> {
        const link = transportFor(endpointId);
        if (!link || server === null) {
            return;
        }
        setError(null);
        setServer({ ...server, state: 'installing' });
        try {
            setServer((await link.request('provider.installServer', { provider: provider.kind })).server);
            const { providers } = await link.request('provider.list', {});
            useProvidersStore.getState().setProviders(endpointId, providers);
        } catch (e) {
            setError(messageOf(e));
            setServer((await link.request('provider.server', { provider: provider.kind }).catch(() => null))?.server ?? server);
        }
    }

    if (!answers || server === null) {
        return null;
    }
    const installing = server.state === 'installing';
    const description =
        error ??
        (server.state === 'failed' ? (server.error ?? '') : t(`providers.acpServer.state.${server.state}`, { version: server.installed ?? server.version }));
    const offersInstall = server.state === 'missing' || server.state === 'failed' || (server.state === 'installed' && server.installed !== server.version);

    return (
        <SettingsSection title={t('providers.acpServer.title', { name: provider.name })} description={t('providers.acpServer.description')} scope="machine">
            <SettingsRow
                searchId="providers.acpServer"
                label={t('providers.acpServer.label', { version: server.version })}
                description={local ? description : t('providers.acpServer.localOnly')}
                control={
                    installing ? (
                        <Spinner size={12} />
                    ) : (
                        offersInstall && (
                            <Button size="sm" variant="secondary" disabled={!local} onClick={() => void install()}>
                                {server.installed === null ? t('providers.acpServer.install') : t('providers.acpServer.update', { version: server.version })}
                            </Button>
                        )
                    )
                }
            />
        </SettingsSection>
    );
}
