import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ClaudeApiSettings, ClaudeApiStatus, NanoGptSettings, NanoGptStatus } from '@ruimte/contracts';
import { Button, Input, Switch, messageOf } from '@adecore/ui';
import { SettingsRow } from '@adecore/ui/settings';
import { useProvidersStore } from '@adecore/agents-react/state';
import { CountField } from '@/shell/settings/providers/CountField';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { transportFor, type Transport } from '@/transport';

interface RunSettings {
    readonly autoContinue: boolean;
    readonly roundsPerRun: number;
    readonly runs: number;
}

interface KeyStatus<Settings> {
    readonly configured: boolean;
    readonly models: number;
    readonly settings?: Settings;
}

/* An empty key disconnects, no key fetches the models again, and settings alone fetch nothing. */
interface KeyPayload<Settings> {
    readonly apiKey?: string;
    readonly settings?: Partial<RunSettings> | Partial<Settings>;
}

interface ApiKeySectionProps<Settings extends RunSettings> {
    readonly endpointId: string;
    readonly title: string;
    readonly words: 'providers.nanogpt' | 'providers.claudeApi';
    status(link: Transport): Promise<KeyStatus<Settings>>;
    configure(link: Transport, payload: KeyPayload<Settings>): Promise<KeyStatus<Settings>>;
    extraRows?(settings: Settings, change: (next: Partial<Settings>) => void): ReactNode;
}

/*
 * A provider behind an API key a person made themselves. The key goes to the machine once and never comes
 * back: the field stays empty and the status only says whether one is saved. Mounted per machine (`key`), so
 * another machine starts from an empty field.
 */
function ApiKeySection<Settings extends RunSettings>({ endpointId, title, words, status: read, configure: write, extraRows }: ApiKeySectionProps<Settings>) {
    const { t } = useTranslation('settings');
    const [apiKey, setApiKey] = useState('');
    const [status, setStatus] = useState<KeyStatus<Settings> | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        const link = transportFor(endpointId);

        if (!link) {
            return;
        }

        let active = true;

        read(link).then(
            (value) => {
                if (active) {
                    setStatus(value);
                }
            },
            () => {
                if (active) {
                    setError(t(`${words}.unavailable`));
                }
            }
        );

        return () => {
            active = false;
        };
    }, [endpointId, read, words, t]);

    const configure = async (payload: KeyPayload<Settings>): Promise<void> => {
        const link = transportFor(endpointId);

        if (!link) {
            return;
        }

        setBusy(true);
        setError('');

        try {
            setStatus(await write(link, payload));
            setApiKey('');
            const { providers } = await link.request('provider.list', {});
            useProvidersStore.getState().setProviders(endpointId, providers);
        } catch (cause) {
            setError(messageOf(cause, t(`${words}.failed`)));
        } finally {
            setBusy(false);
        }
    };

    // Settings alone change no model, so the provider list stays as it is.
    const change = async (settings: KeyPayload<Settings>['settings']): Promise<void> => {
        const link = transportFor(endpointId);

        if (!link) {
            return;
        }

        setError('');

        try {
            setStatus(await write(link, { settings }));
        } catch (cause) {
            setError(messageOf(cause, t(`${words}.failed`)));
        }
    };

    const settings = status?.settings;
    const state = busy
        ? t(`${words}.loading`)
        : status === null
          ? t(`${words}.unknown`)
          : status.configured
            ? t(`${words}.ready`, { count: status.models })
            : t(`${words}.disconnected`);

    return (
        <SettingsSection title={title} description={t(`${words}.description`)} scope="machine" footer={t(`${words}.footer`)}>
            <SettingsRow
                label={t(`${words}.key`)}
                description={t(`${words}.keyDescription`)}
                control={
                    <Input
                        type="password"
                        value={apiKey}
                        onChange={(event) => setApiKey(event.target.value)}
                        autoComplete="off"
                        aria-label={t(`${words}.key`)}
                        placeholder={status?.configured ? t(`${words}.saved`) : ''}
                        disabled={busy}
                    />
                }
            />
            <SettingsRow
                label={t(`${words}.status`)}
                description={state}
                control={
                    <div className="flex gap-2">
                        <Button disabled={busy || apiKey.trim() === ''} onClick={() => void configure({ apiKey: apiKey.trim() })}>
                            {t(`${words}.save`)}
                        </Button>
                        <Button disabled={busy || !status?.configured} onClick={() => void configure({})}>
                            {t(`${words}.refresh`)}
                        </Button>
                        <Button disabled={busy || !status?.configured} onClick={() => void configure({ apiKey: '' })}>
                            {t(`${words}.disconnect`)}
                        </Button>
                    </div>
                }
            />
            {settings !== undefined && (
                <>
                    <SettingsRow
                        label={t(`${words}.continue.label`)}
                        description={t(`${words}.continue.description`)}
                        control={
                            <Switch
                                checked={settings.autoContinue}
                                onCheckedChange={(autoContinue) => void change({ autoContinue })}
                                label={t(`${words}.continue.label`)}
                            />
                        }
                    />
                    <SettingsRow
                        label={t(`${words}.rounds.label`)}
                        description={t(`${words}.rounds.description`)}
                        control={
                            <CountField
                                value={settings.roundsPerRun}
                                min={5}
                                max={200}
                                label={t(`${words}.rounds.label`)}
                                disabled={false}
                                onCommit={(roundsPerRun) => void change({ roundsPerRun })}
                            />
                        }
                    />
                    <SettingsRow
                        label={t(`${words}.runs.label`)}
                        description={t(`${words}.runs.description`)}
                        control={
                            <CountField
                                value={settings.runs}
                                min={1}
                                max={20}
                                label={t(`${words}.runs.label`)}
                                disabled={!settings.autoContinue}
                                onCommit={(runs) => void change({ runs })}
                            />
                        }
                    />
                    {extraRows?.(settings, (next) => void change(next))}
                </>
            )}
            {error !== '' && (
                <p role="alert" className="px-3 pb-3 break-words text-status-error">
                    {error}
                </p>
            )}
        </SettingsSection>
    );
}

function nanoGptStatus(link: Transport): Promise<NanoGptStatus> {
    return link.request('nanogpt.status', {});
}

function configureNanoGpt(link: Transport, payload: KeyPayload<NanoGptSettings>): Promise<NanoGptStatus> {
    return link.request('nanogpt.configure', payload);
}

function claudeApiStatus(link: Transport): Promise<ClaudeApiStatus> {
    return link.request('anthropic.status', {});
}

function configureClaudeApi(link: Transport, payload: KeyPayload<ClaudeApiSettings>): Promise<ClaudeApiStatus> {
    return link.request('anthropic.configure', payload);
}

export function NanoGptSection({ endpointId }: { endpointId: string }) {
    return <ApiKeySection endpointId={endpointId} title="NanoGPT" words="providers.nanogpt" status={nanoGptStatus} configure={configureNanoGpt} />;
}

export function ClaudeApiSection({ endpointId }: { endpointId: string }) {
    const { t } = useTranslation('settings');

    return (
        <ApiKeySection
            endpointId={endpointId}
            title="Claude API"
            words="providers.claudeApi"
            status={claudeApiStatus}
            configure={configureClaudeApi}
            extraRows={(settings, change) => (
                <SettingsRow
                    label={t('providers.claudeApi.tokens.label')}
                    description={t('providers.claudeApi.tokens.description')}
                    control={
                        <CountField
                            value={settings.maxOutputTokens}
                            min={1024}
                            max={128000}
                            label={t('providers.claudeApi.tokens.label')}
                            disabled={false}
                            onCommit={(maxOutputTokens) => change({ maxOutputTokens })}
                        />
                    }
                />
            )}
        />
    );
}
