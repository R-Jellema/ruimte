import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProviderInfo } from '@ruimte/contracts';
import { useProvidersStore } from '@adecore/agents-react/state';
import { perform } from '@/actions/client-actions';
import { useServers } from '@/state/server';
import { useToasts } from '@/state/toasts';
import { transportFor } from '@/transport';
import { useEndpointConnection } from '@/transport/status';

interface AppleFoundation {
    enabled: boolean;
    /* Whether the switch can act: a Mac that answers and knows the setting, and nothing on the way. */
    switchable: boolean;
    /* Where the model on the machine stands, in a sentence. */
    status: string;
    setEnabled(checked: boolean): void;
}

/*
 * The model a Mac runs on its own, behind the one switch of its machine. Flipping it saves the machine's
 * identity and asks for its providers again, since turning the model on or off changes that list.
 */
export function useAppleFoundation(endpointId: string, provider: ProviderInfo | null): AppleFoundation {
    const { t } = useTranslation('settings');
    const info = useServers((state) => state.byEndpoint[endpointId]);
    const connection = useEndpointConnection(endpointId);
    const [busy, setBusy] = useState(false);
    const connected = connection.status === 'open';
    const mac = info?.platform === 'darwin';
    const enabled = info?.appleFoundationEnabled === true;

    const setEnabled = async (checked: boolean): Promise<void> => {
        const link = transportFor(endpointId);
        if (!link) {
            return;
        }
        setBusy(true);
        try {
            await perform('machine.setIdentity', { endpointId, appleFoundationEnabled: checked });
            const { providers } = await link.request('provider.list', {});
            useProvidersStore.getState().setProviders(endpointId, providers);
        } catch (error) {
            useToasts.getState().show({
                id: `apple-foundation-${endpointId}`,
                kind: 'error',
                title: t('providers.apple.saveFailed'),
                description: error instanceof Error ? error.message : t('machine.toast.unchanged')
            });
        } finally {
            setBusy(false);
        }
    };

    const status = !connected
        ? t('machine.notAnswering')
        : !mac
          ? t('providers.apple.requiresMac')
          : !enabled
            ? t('providers.apple.disabled')
            : provider?.installed
              ? t('providers.apple.ready')
              : (provider?.version ?? t('providers.apple.unavailable'));

    return {
        enabled,
        switchable: connected && mac && !busy,
        status,
        setEnabled: (checked) => void setEnabled(checked)
    };
}
