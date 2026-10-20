import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { NanoGptConfigurePayload, NanoGptStatus } from '@ruimte/contracts';
import { Button, Input } from '@adecore/ui';
import { SettingsRow } from '@adecore/ui/settings';
import { useProvidersStore } from '@adecore/agents-react/state';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { transportFor } from '@/transport';

/*
 * The NanoGPT subscription of a machine. The key goes to the machine once and never comes back: the
 * field stays empty and the status only says whether one is saved. Mounted per machine (`key`), so
 * another machine starts from an empty field.
 */
export function NanoGptSection({ endpointId }: { endpointId: string }) {
    const { t } = useTranslation('settings');
    const [apiKey, setApiKey] = useState('');
    const [status, setStatus] = useState<NanoGptStatus | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        const link = transportFor(endpointId);
        if (!link) {
            return;
        }
        let active = true;
        link.request('nanogpt.status', {}).then(
            (value) => {
                if (active) {
                    setStatus(value);
                }
            },
            () => {
                if (active) {
                    setError(t('providers.nanogpt.unavailable'));
                }
            }
        );
        return () => {
            active = false;
        };
    }, [endpointId, t]);

    const configure = async (payload: NanoGptConfigurePayload): Promise<void> => {
        const link = transportFor(endpointId);
        if (!link) {
            return;
        }
        setBusy(true);
        setError('');
        try {
            setStatus(await link.request('nanogpt.configure', payload));
            setApiKey('');
            const { providers } = await link.request('provider.list', {});
            useProvidersStore.getState().setProviders(endpointId, providers);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : t('providers.nanogpt.failed'));
        } finally {
            setBusy(false);
        }
    };

    const state = busy
        ? t('providers.nanogpt.loading')
        : status === null
          ? t('providers.nanogpt.unknown')
          : status.configured
            ? t('providers.nanogpt.ready', { count: status.models })
            : t('providers.nanogpt.disconnected');

    return (
        <SettingsSection title="NanoGPT Subscription" description={t('providers.nanogpt.description')} scope="machine" footer={t('providers.nanogpt.footer')}>
            <SettingsRow
                label={t('providers.nanogpt.key')}
                description={t('providers.nanogpt.keyDescription')}
                control={
                    <Input
                        type="password"
                        value={apiKey}
                        onChange={(event) => setApiKey(event.target.value)}
                        autoComplete="off"
                        aria-label={t('providers.nanogpt.key')}
                        placeholder={status?.configured ? t('providers.nanogpt.saved') : ''}
                        disabled={busy}
                    />
                }
            />
            <SettingsRow
                label={t('providers.nanogpt.status')}
                description={state}
                control={
                    <div className="flex gap-2">
                        <Button disabled={busy || apiKey.trim() === ''} onClick={() => void configure({ apiKey: apiKey.trim() })}>
                            {t('providers.nanogpt.save')}
                        </Button>
                        <Button disabled={busy || !status?.configured} onClick={() => void configure({})}>
                            {t('providers.nanogpt.refresh')}
                        </Button>
                        <Button disabled={busy || !status?.configured} onClick={() => void configure({ apiKey: '' })}>
                            {t('providers.nanogpt.disconnect')}
                        </Button>
                    </div>
                }
            />
            {error !== '' && (
                <p role="alert" className="px-3 pb-3 break-words text-status-error">
                    {error}
                </p>
            )}
        </SettingsSection>
    );
}
