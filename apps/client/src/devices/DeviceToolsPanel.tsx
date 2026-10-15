import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardCopy, ClipboardPaste, Copy, Download, Frame, LoaderCircle, Square, Video } from 'lucide-react';
import {
    devicePermissions,
    deviceTools,
    type DeviceAction,
    type DeviceColorFilter,
    type DeviceInfo,
    type DevicePermission,
    type DeviceSettings,
    type DeviceTextSize,
    type DeviceToggleSetting,
    type DeviceTool
} from '@ruimte/contracts';
import { copyScreenshot, placeScreenshotOnCanvas, saveScreenshot, startRecording, stopRecording } from '@/devices/device-capture';
import { recordingKey, useDevices, useRecordingSince } from '@/devices/state';
import { useEndpointId } from '@/state/keys';
import { deviceClientFor } from '@/transport/connections';
import { useMachineAnswers } from '@/transport/features';
import { formatClockDuration } from '@adecore/ui/format';
import {
    Segmented,
    Switch,
    Button,
    ButtonGroup,
    CloseButton,
    FormError,
    Icon,
    IconButton,
    Input,
    PanelHeader,
    SectionLabel,
    Select,
    useNow
} from '@adecore/ui';

type ActionBody = DeviceAction extends infer Action ? (Action extends DeviceAction ? Omit<Action, 'backendId' | 'platform' | 'deviceId'> : never) : never;

const TEXT_SIZES: readonly DeviceTextSize[] = ['small', 'default', 'large', 'extra-large'];

const COLOR_FILTERS: readonly DeviceColorFilter[] = ['none', 'grayscale', 'red-green', 'green-red', 'blue-yellow'];

const TOGGLES: readonly DeviceToggleSetting[] = ['reduceMotion', 'increaseContrast', 'reduceTransparency', 'showBorders', 'voiceOver'];

const APP_TOOLS: readonly DeviceTool[] = ['openUrl', 'launchApp', 'terminateApp'];

const DISPLAY_TOOLS: readonly DeviceTool[] = ['appearance', 'textSize', 'liquidGlass', 'colorFilter', ...TOGGLES];

/* City names and their coordinates, which read the same in every language. */
const LOCATIONS = [
    { label: 'San Francisco', latitude: 37.7749, longitude: -122.4194 },
    { label: 'New York', latitude: 40.7128, longitude: -74.006 },
    { label: 'London', latitude: 51.5074, longitude: -0.1278 },
    { label: 'Amsterdam', latitude: 52.3676, longitude: 4.9041 },
    { label: 'Tokyo', latitude: 35.6762, longitude: 139.6503 }
] as const;

export function DeviceToolsPanel({ device, onClose }: { device: DeviceInfo; onClose: () => void }) {
    const { t } = useTranslation('machines');
    const endpointId = useEndpointId();
    const [settings, setSettings] = useState<DeviceSettings | null>(null);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const answersCapture = useMachineAnswers(endpointId, 'device.capture');
    const answersRecord = useMachineAnswers(endpointId, 'device.record');
    const answersClipboard = useMachineAnswers(endpointId, 'device.clipboard');

    useEffect(() => {
        let active = true;
        void deviceClientFor(endpointId)
            ?.detail(device)
            .then((detail) => {
                if (active) {
                    setSettings(detail.settings);
                    noteRecording(endpointId, device, detail.settings.recording);
                }
            })
            .catch((cause: unknown) => {
                if (active) {
                    setError(cause instanceof Error ? cause.message : t('device.tools.readFailed'));
                }
            });
        return () => {
            active = false;
        };
    }, [device, endpointId, t]);

    const act = async (body: ActionBody): Promise<void> => {
        const client = deviceClientFor(endpointId);
        if (!client) {
            return;
        }
        setPending(true);
        setError(null);
        try {
            const detail = await client.action({ backendId: device.backendId, platform: device.platform, deviceId: device.deviceId, ...body } as DeviceAction);
            setSettings(detail.settings);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : t('device.tools.changeFailed'));
        } finally {
            setPending(false);
        }
    };

    const tools = deviceTools(device);
    const has = (tool: DeviceTool): boolean => tools.includes(tool);
    /* A tool a person reaches through a request of its own, which the machine has to name too. */
    const canCapture = has('capture') && answersCapture;
    const canRecord = has('record') && answersRecord;
    const canClipboard = has('clipboard') && answersClipboard;
    const appTools = APP_TOOLS.filter(has);
    const displayTools = DISPLAY_TOOLS.filter(has);
    const permissions = devicePermissions(device);
    const appIdPlaceholder = device.platform === 'android' ? t('device.tools.packageName') : t('device.tools.bundleId');
    const disabled = pending || settings === null;
    return (
        <aside className="flex h-full min-h-0 w-full flex-col bg-surface">
            <PanelHeader title={t('device.tools.title')}>
                {pending && <Icon icon={LoaderCircle} size={14} className="animate-spin text-text-muted" />}
                <CloseButton label={t('device.tools.close')} className="ml-auto" onClick={onClose} />
            </PanelHeader>
            <div className="min-h-0 grow overflow-y-auto">
                {error && <FormError className="border-b border-border px-3 py-2 break-words">{error}</FormError>}
                {settings === null && !error && (
                    <div className="flex items-center gap-2 px-3 py-3 text-xs text-text-muted">
                        <Icon icon={LoaderCircle} size={14} className="animate-spin" /> {t('device.tools.loading')}
                    </div>
                )}
                {(canCapture || canRecord) && <CaptureTools device={device} canCapture={canCapture} canRecord={canRecord} onError={setError} />}
                {canClipboard && <ClipboardTools device={device} onError={setError} />}
                {appTools.length > 0 && (
                    <ToolSection title={t('device.tools.app.title')}>
                        {has('openUrl') && (
                            <TextAction
                                placeholder={t('device.tools.app.urlPlaceholder')}
                                label={t('device.tools.app.open')}
                                disabled={disabled}
                                onSubmit={(url) => act({ action: 'openUrl', url })}
                            />
                        )}
                        {has('launchApp') && (
                            <TextAction
                                placeholder={appIdPlaceholder}
                                label={t('device.tools.app.launch')}
                                disabled={disabled}
                                onSubmit={(appId) => act({ action: 'launchApp', appId })}
                            />
                        )}
                        {has('terminateApp') && (
                            <TextAction
                                placeholder={appIdPlaceholder}
                                label={t('device.tools.app.terminate')}
                                disabled={disabled}
                                onSubmit={(appId) => act({ action: 'terminateApp', appId })}
                            />
                        )}
                    </ToolSection>
                )}
                {displayTools.length > 0 && (
                    <ToolSection title={t('device.tools.display.title')}>
                        {has('appearance') && (
                            <ToolRow label={t('device.tools.display.appearance')}>
                                <Segmented
                                    label={t('device.tools.display.appearance')}
                                    value={settings?.appearance ?? 'light'}
                                    options={[
                                        { id: 'light', label: t('device.tools.display.light') },
                                        { id: 'dark', label: t('device.tools.display.dark') }
                                    ]}
                                    disabled={disabled || settings?.appearance === undefined}
                                    onValueChange={(value) => void act({ action: 'setAppearance', value })}
                                />
                            </ToolRow>
                        )}
                        {has('textSize') && (
                            <ToolRow label={t('device.tools.display.textSize')}>
                                <Select
                                    label={t('device.tools.display.textSize')}
                                    value={settings?.textSize ?? null}
                                    items={TEXT_SIZES.map((size) => ({ value: size, label: t(`device.tools.textSizes.${size}`) }))}
                                    size="sm"
                                    align="end"
                                    disabled={disabled || settings?.textSize === undefined}
                                    onValueChange={(value) => void act({ action: 'setTextSize', value })}
                                />
                            </ToolRow>
                        )}
                        {has('liquidGlass') && (
                            <ToolRow label={t('device.tools.display.liquidGlass')}>
                                <Segmented
                                    label={t('device.tools.display.liquidGlass')}
                                    value={settings?.liquidGlass ?? 'clear'}
                                    options={[
                                        { id: 'clear', label: t('device.tools.display.clear') },
                                        { id: 'tinted', label: t('device.tools.display.tinted') }
                                    ]}
                                    disabled={disabled || settings?.liquidGlass === undefined}
                                    onValueChange={(value) => void act({ action: 'setLiquidGlass', value })}
                                />
                            </ToolRow>
                        )}
                        {has('colorFilter') && (
                            <ToolRow label={t('device.tools.display.colorFilter')}>
                                <Select
                                    label={t('device.tools.display.colorFilter')}
                                    value={settings?.colorFilter ?? null}
                                    items={COLOR_FILTERS.map((filter) => ({ value: filter, label: t(`device.tools.colorFilters.${filter}`) }))}
                                    size="sm"
                                    align="end"
                                    disabled={disabled || settings?.colorFilter === undefined}
                                    onValueChange={(value) => void act({ action: 'setColorFilter', value })}
                                />
                            </ToolRow>
                        )}
                        {TOGGLES.filter(has).map((setting) => (
                            <SettingToggle
                                key={setting}
                                label={t(`device.tools.display.${setting}`)}
                                setting={setting}
                                value={settings?.[setting]}
                                disabled={disabled}
                                act={act}
                            />
                        ))}
                    </ToolSection>
                )}
                {(has('location') || has('clearLocation')) && (
                    <LocationTools canSet={has('location')} canClear={has('clearLocation')} disabled={disabled} act={act} />
                )}
                {has('permissions') && permissions.length > 0 && (
                    <PermissionTools permissions={permissions} appIdPlaceholder={appIdPlaceholder} disabled={disabled} act={act} />
                )}
                {has('push') && (
                    <ToolSection title={t('device.tools.push.title')}>
                        <PushAction appIdPlaceholder={appIdPlaceholder} disabled={disabled} act={act} />
                    </ToolSection>
                )}
            </div>
        </aside>
    );
}

/* A recording another client began, or one from before a reload, still shows; one that ended elsewhere goes. */
function noteRecording(endpointId: string, device: DeviceInfo, recording: boolean | undefined): void {
    const key = recordingKey(endpointId, device);
    const known = useDevices.getState().recordings[key] !== undefined;
    if (recording === true && !known) {
        useDevices.getState().markRecording(key, Date.now());
    } else if (recording === false && known) {
        useDevices.getState().markRecording(key, null);
    }
}

function CaptureTools({
    device,
    canCapture,
    canRecord,
    onError
}: {
    device: DeviceInfo;
    canCapture: boolean;
    canRecord: boolean;
    onError: (message: string | null) => void;
}) {
    const { t } = useTranslation('machines');
    const endpointId = useEndpointId();
    const [busy, setBusy] = useState<'copy' | 'save' | 'place' | 'record' | null>(null);
    const since = useRecordingSince(endpointId, device);
    const now = useNow(1_000, since !== null);
    const run = (step: Exclude<typeof busy, null>, work: () => Promise<unknown>, failure: string): void => {
        setBusy(step);
        onError(null);
        void work()
            .catch((cause: unknown) => onError(cause instanceof Error ? cause.message : failure))
            .finally(() => setBusy(null));
    };
    const place = async (): Promise<void> => {
        if (!(await placeScreenshotOnCanvas(endpointId, device))) {
            onError(t('device.tools.capture.noCanvas'));
        }
    };
    return (
        <ToolSection title={t('device.tools.capture.title')}>
            {canCapture && (
                <ToolRow label={t('device.tools.capture.screenshot')}>
                    <ButtonGroup>
                        <IconButton
                            icon={Copy}
                            size="sm"
                            busy={busy === 'copy'}
                            disabled={busy !== null}
                            label={t('device.tools.capture.copy')}
                            onClick={() => run('copy', () => copyScreenshot(endpointId, device), t('device.tools.capture.failed'))}
                        />
                        <IconButton
                            icon={Download}
                            size="sm"
                            busy={busy === 'save'}
                            disabled={busy !== null}
                            label={t('device.tools.capture.save')}
                            onClick={() => run('save', () => saveScreenshot(endpointId, device), t('device.tools.capture.failed'))}
                        />
                        <IconButton
                            icon={Frame}
                            size="sm"
                            busy={busy === 'place'}
                            disabled={busy !== null}
                            label={t('device.tools.capture.place')}
                            onClick={() => run('place', place, t('device.tools.capture.failed'))}
                        />
                    </ButtonGroup>
                </ToolRow>
            )}
            {canRecord && (
                <>
                    <ToolRow label={t('device.tools.capture.record')}>
                        <div className="flex items-center gap-2">
                            {since !== null && (
                                <span className="font-mono text-xs text-text-muted tabular-nums">{formatClockDuration(Math.max(0, now - since))}</span>
                            )}
                            <Button
                                size="sm"
                                variant="secondary"
                                disabled={busy !== null}
                                onClick={() =>
                                    run(
                                        'record',
                                        () => (since === null ? startRecording(endpointId, device) : stopRecording(endpointId, device)),
                                        t('device.tools.capture.recordFailed')
                                    )
                                }
                            >
                                {busy === 'record' ? (
                                    <Icon icon={LoaderCircle} size={12} className="animate-spin" />
                                ) : (
                                    <Icon icon={since === null ? Video : Square} size={12} />
                                )}{' '}
                                {since === null ? t('device.tools.capture.start') : t('device.tools.capture.stop')}
                            </Button>
                        </div>
                    </ToolRow>
                    {device.platform === 'android' && <p className="text-xs text-text-muted">{t('device.tools.capture.androidLimit')}</p>}
                </>
            )}
        </ToolSection>
    );
}

/*
 * The clipboard of the client a person sits at, not the machine's, so the same buttons work from
 * another machine or a browser.
 */
function ClipboardTools({ device, onError }: { device: DeviceInfo; onError: (message: string | null) => void }) {
    const { t } = useTranslation('machines');
    const endpointId = useEndpointId();
    const [busy, setBusy] = useState<'send' | 'copy' | null>(null);
    const run = (step: 'send' | 'copy', work: () => Promise<unknown>): void => {
        setBusy(step);
        onError(null);
        void work()
            .catch((cause: unknown) => onError(cause instanceof Error ? cause.message : t('device.tools.clipboard.failed')))
            .finally(() => setBusy(null));
    };
    const send = async (): Promise<void> => {
        const text = await navigator.clipboard.readText();
        await deviceClientFor(endpointId)?.clipboard(device, text);
    };
    const copy = async (): Promise<void> => {
        const text = await deviceClientFor(endpointId)?.clipboard(device);
        if (text !== undefined) {
            await navigator.clipboard.writeText(text);
        }
    };
    return (
        <ToolSection title={t('device.tools.clipboard.title')}>
            <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => run('send', send)}>
                    <Icon icon={busy === 'send' ? LoaderCircle : ClipboardPaste} size={12} className={busy === 'send' ? 'animate-spin' : undefined} />{' '}
                    {t('device.tools.clipboard.send')}
                </Button>
                <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => run('copy', copy)}>
                    <Icon icon={busy === 'copy' ? LoaderCircle : ClipboardCopy} size={12} className={busy === 'copy' ? 'animate-spin' : undefined} />{' '}
                    {t('device.tools.clipboard.copy')}
                </Button>
            </div>
        </ToolSection>
    );
}

function ToolSection({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="flex flex-col gap-2.5 border-b border-border px-3 py-3 last:border-b-0">
            <SectionLabel render={<h3 />}>{title}</SectionLabel>
            {children}
        </section>
    );
}

function ToolRow({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex min-h-8 items-center justify-between gap-3">
            <span className="shrink-0 text-xs text-text-muted">{label}</span>
            <div className="flex min-w-0 justify-end">{children}</div>
        </div>
    );
}

function SettingToggle({
    label,
    setting,
    value,
    disabled,
    act
}: {
    label: string;
    setting: DeviceToggleSetting;
    value: boolean | undefined;
    disabled: boolean;
    act: (body: ActionBody) => Promise<void>;
}) {
    return (
        <ToolRow label={label}>
            <Switch
                checked={value ?? false}
                label={label}
                disabled={disabled || value === undefined}
                onCheckedChange={(next) => void act({ action: 'setToggle', setting, value: next })}
            />
        </ToolRow>
    );
}

function TextAction({
    placeholder,
    label,
    disabled,
    onSubmit
}: {
    placeholder: string;
    label: string;
    disabled: boolean;
    onSubmit: (value: string) => Promise<void>;
}) {
    const [value, setValue] = useState('');
    const submit = (event: FormEvent): void => {
        event.preventDefault();
        const trimmed = value.trim();
        if (!trimmed) {
            return;
        }
        void onSubmit(trimmed).then(() => setValue(''));
    };
    return (
        <form className="flex gap-1.5" onSubmit={submit}>
            <Input
                size="sm"
                className="min-w-0 grow disabled:opacity-50"
                value={value}
                disabled={disabled}
                placeholder={placeholder}
                onChange={(event) => setValue(event.target.value)}
            />
            <Button type="submit" size="sm" variant="secondary" disabled={disabled || value.trim().length === 0}>
                {label}
            </Button>
        </form>
    );
}

function LocationTools({
    canSet,
    canClear,
    disabled,
    act
}: {
    canSet: boolean;
    canClear: boolean;
    disabled: boolean;
    act: (body: ActionBody) => Promise<void>;
}) {
    const { t } = useTranslation('machines');
    const [latitude, setLatitude] = useState('');
    const [longitude, setLongitude] = useState('');
    const parsed = { latitude: Number(latitude), longitude: Number(longitude) };
    const valid = latitude.trim() !== '' && longitude.trim() !== '' && Math.abs(parsed.latitude) <= 90 && Math.abs(parsed.longitude) <= 180;
    return (
        <ToolSection title={t('device.tools.location.title')}>
            {canSet && (
                <div className="flex gap-1.5">
                    <Input
                        size="sm"
                        className="w-1/2 min-w-0 disabled:opacity-50"
                        inputMode="decimal"
                        value={latitude}
                        disabled={disabled}
                        placeholder={t('device.tools.location.latitude')}
                        onChange={(event) => setLatitude(event.target.value)}
                    />
                    <Input
                        size="sm"
                        className="w-1/2 min-w-0 disabled:opacity-50"
                        inputMode="decimal"
                        value={longitude}
                        disabled={disabled}
                        placeholder={t('device.tools.location.longitude')}
                        onChange={(event) => setLongitude(event.target.value)}
                    />
                </div>
            )}
            <div className="flex flex-wrap gap-1.5">
                {canSet && (
                    <>
                        <Select
                            label={t('device.tools.location.preset')}
                            value={null}
                            placeholder={t('device.tools.location.presetPlaceholder')}
                            items={LOCATIONS.map((location) => ({ value: location.label, label: location.label }))}
                            size="sm"
                            disabled={disabled}
                            onValueChange={(label) => {
                                const location = LOCATIONS.find((candidate) => candidate.label === label);
                                if (location) {
                                    setLatitude(String(location.latitude));
                                    setLongitude(String(location.longitude));
                                    void act({ action: 'setLocation', latitude: location.latitude, longitude: location.longitude });
                                }
                            }}
                        />
                        <Button size="sm" variant="secondary" disabled={disabled || !valid} onClick={() => void act({ action: 'setLocation', ...parsed })}>
                            {t('device.tools.location.set')}
                        </Button>
                    </>
                )}
                {canClear && (
                    <Button
                        size="sm"
                        disabled={disabled}
                        onClick={() => {
                            setLatitude('');
                            setLongitude('');
                            void act({ action: 'clearLocation' });
                        }}
                    >
                        {t('device.tools.location.clear')}
                    </Button>
                )}
            </div>
        </ToolSection>
    );
}

function PermissionTools({
    permissions,
    appIdPlaceholder,
    disabled,
    act
}: {
    permissions: DevicePermission[];
    appIdPlaceholder: string;
    disabled: boolean;
    act: (body: ActionBody) => Promise<void>;
}) {
    const { t } = useTranslation('machines');
    const [appId, setAppId] = useState('');
    const [permission, setPermission] = useState<DevicePermission>(permissions[0]!);
    const decide = (decision: 'grant' | 'revoke' | 'reset'): void => {
        const resolved = appId.trim();
        if (resolved) {
            void act({ action: 'setPermission', appId: resolved, permission, decision });
        }
    };
    return (
        <ToolSection title={t('device.tools.permissions.title')}>
            <Input
                size="sm"
                className="min-w-0 disabled:opacity-50"
                value={appId}
                disabled={disabled}
                placeholder={appIdPlaceholder}
                onChange={(event) => setAppId(event.target.value)}
            />
            <div className="flex flex-wrap gap-1.5">
                <Select<DevicePermission>
                    label={t('device.tools.permissions.label')}
                    value={permission}
                    items={permissions.map((value) => ({ value, label: t(`device.tools.permissions.kinds.${value}`) }))}
                    size="sm"
                    disabled={disabled}
                    onValueChange={setPermission}
                />
                <Button size="sm" variant="secondary" disabled={disabled || !appId.trim()} onClick={() => decide('grant')}>
                    {t('device.tools.permissions.grant')}
                </Button>
                <Button size="sm" variant="secondary" disabled={disabled || !appId.trim()} onClick={() => decide('revoke')}>
                    {t('device.tools.permissions.revoke')}
                </Button>
                <Button size="sm" disabled={disabled || !appId.trim()} onClick={() => decide('reset')}>
                    {t('device.tools.permissions.reset')}
                </Button>
            </div>
        </ToolSection>
    );
}

function PushAction({ appIdPlaceholder, disabled, act }: { appIdPlaceholder: string; disabled: boolean; act: (body: ActionBody) => Promise<void> }) {
    const { t } = useTranslation('machines');
    const [appId, setAppId] = useState('');
    const [payload, setPayload] = useState('');
    const submit = (event: FormEvent): void => {
        event.preventDefault();
        if (appId.trim() && payload.trim()) {
            void act({ action: 'sendPush', appId: appId.trim(), payload: payload.trim() }).then(() => setPayload(''));
        }
    };
    return (
        <form className="flex flex-col gap-1.5" onSubmit={submit}>
            <Input
                size="sm"
                className="min-w-0 disabled:opacity-50"
                value={appId}
                disabled={disabled}
                placeholder={appIdPlaceholder}
                onChange={(event) => setAppId(event.target.value)}
            />
            <div className="flex gap-1.5">
                <Input
                    size="sm"
                    className="min-w-0 grow disabled:opacity-50"
                    value={payload}
                    disabled={disabled}
                    placeholder={t('device.tools.push.alertText')}
                    onChange={(event) => setPayload(event.target.value)}
                />
                <Button type="submit" size="sm" variant="secondary" disabled={disabled || !appId.trim() || !payload.trim()}>
                    {t('device.tools.push.send')}
                </Button>
            </div>
        </form>
    );
}
