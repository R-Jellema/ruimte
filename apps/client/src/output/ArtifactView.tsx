import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { CircleAlert, Download, FilePlus, GitCompare, Info, Lock, Package, Pin, Trash2, WifiOff } from 'lucide-react';
import { patchOf } from '@adecore/merge';
import { VisualPageFrame } from '@adecore/agents-react/chat/ui';
import { AgentIcon, modelName, ProviderLogo } from '@adecore/agents-react/providers';
import { useChats, useProvidersStore } from '@adecore/agents-react/state';
import { BYTES_READ_MAX_BYTES, type Artifact, type ArtifactGetResult, type ArtifactProvenance, type ArtifactVersion } from '@ruimte/contracts';
import { hasProviderLogo } from '@/agents/provider-logo';
import { ContextMenu, EmptyState, ErrorBoundary, Icon, IconButton, LazyBoundary, Menu, Pill, SectionLabel, lazyNamed, Tooltip } from '@adecore/ui';
import type { CopyToProjectRequest } from '@/output/CopyToProjectDialog';
import { pinArtifact, useCanRemove, usePinCanvases } from '@/output/artifact-actions';
import { RemoveArtifactDialog, type RemoveArtifactRequest } from '@/output/RemoveArtifactDialog';
import { ActionRow } from '@/output/look';
import { formatBytes, formatDayClock } from '@adecore/ui/format';
import { comparable, drawnKind, isTextMime } from '@/output/artifact-list';
import { downloadArtifactFile, readArtifactFile, useArtifactText, type ArtifactFileRef } from '@/output/artifact-bytes';
import { showChat, useChatName } from '@/output/kinds';
import { selectArtifactVersion, useArtifactSelection } from '@/output/open';
import { useArtifact } from '@/output/use-artifact';
import { FileMarkdown } from '@/shell/panels/FileMarkdown';
import { FILE_TOOLBAR } from '@/shell/panels/classes';
import { useFileToolbarSlot } from '@/shell/panels/file-toolbar-slot';
import { CopyToThisMachine } from '@/output/CopyToThisMachine';
import { useEndpointIdOfMachine, useEndpoints } from '@/state/endpoints';
import { artifactTabKey } from '@/state/files';
import { endpointKey, useEndpointId } from '@/state/keys';
import { useToasts } from '@/state/toasts';
import { useMachineAnswers } from '@/transport/features';
import { useMachineUrl } from '@/transport/machine-url';

const UnifiedDiff = lazyNamed(() => import('@adecore/agents-react/chat/ui'), 'UnifiedDiff');
const CopyToProjectDialog = lazyNamed(() => import('@/output/CopyToProjectDialog'), 'CopyToProjectDialog');
/*
 * One artifact of Output as a loose view: its versions on the left, the version picked in the middle,
 * where it came from on the right. Every byte is read by the artifact's id and a version's id; the
 * view never names a path on the machine.
 */
export function ArtifactView({ artifactId, machineId, pin }: { artifactId: string; machineId?: string; pin?: ArtifactPin }) {
    const { t } = useTranslation('output');
    const own = useEndpointId();
    const elsewhere = useEndpointIdOfMachine(machineId ?? '');
    const endpointId = machineId === undefined ? own : elsewhere;
    const answers = useMachineAnswers(endpointId, 'artifact.get');
    const state = useArtifact(endpointId, artifactId, answers);

    if (!answers) {
        return <Centered icon={CircleAlert}>{t('panel.tooOld')}</Centered>;
    }
    if (state.status === 'loading') {
        return (
            <Centered busy>
                <span>{t('view.loading')}</span>
            </Centered>
        );
    }
    if (state.status === 'unreachable') {
        return <Centered icon={WifiOff}>{t('view.unreachable')}</Centered>;
    }
    if (state.status === 'gone' || state.result.versions.length === 0) {
        return <Centered icon={Package}>{t('view.gone')}</Centered>;
    }
    return <ArtifactBody endpointId={endpointId} machineId={machineId} result={state.result} pin={pin} />;
}

/*
 * The version a view of the project stays on, stored with the view the way a node stores it: null
 * follows the latest. Without one the version picked is the window's, as for a loose tab.
 */
export interface ArtifactPin {
    version: string | null;
    set(version: string | null): void;
}

function Centered({ icon, busy, children }: { icon?: typeof Package; busy?: boolean; children: ReactNode }) {
    return (
        <div className="grid min-h-0 grow place-items-center">
            <EmptyState icon={icon} busy={busy}>
                {children}
            </EmptyState>
        </div>
    );
}

/* `machineId` is set for an artifact another machine of the account keeps, which the window copies but never writes into. */
function ArtifactBody({
    endpointId,
    machineId,
    result,
    pin
}: {
    endpointId: string;
    machineId: string | undefined;
    result: ArtifactGetResult;
    pin: ArtifactPin | undefined;
}) {
    const { t } = useTranslation('output');
    const { artifact, versions } = result;
    const selected = useArtifactSelection((s) => s.versions[artifactTabKey(artifact.artifactId, machineId)] ?? null);
    const chosen = pin === undefined ? selected : pin.version;
    const [comparing, setComparing] = useState(false);
    const [baseId, setBaseId] = useState<string | null>(null);
    const [infoOpen, setInfoOpen] = useState(true);
    const [copy, setCopy] = useState<CopyToProjectRequest | null>(null);
    const [removing, setRemoving] = useState<RemoveArtifactRequest | null>(null);
    const canRemove = useCanRemove(endpointId, machineId);
    const latest = versions[0]!;
    const totalBytes = versions.reduce((sum, entry) => sum + entry.bytes, 0);
    const askRemove = (picked: ArtifactVersion | null): void =>
        setRemoving({ artifact, version: picked, versionCount: versions.length, totalBytes, open: true });
    // A version picked from the panel that a cleanup took since is said to be gone, not swapped for another.
    const version = chosen === null ? latest : (versions.find((entry) => entry.versionId === chosen) ?? null);
    const canCompare = version !== null && versions.length > 1 && drawnKind(artifact.kind) === 'report' && comparable(version);
    const compare = comparing && canCompare;
    const base = compare ? baseFor(versions, version, baseId) : null;

    const pick = (picked: ArtifactVersion): void => {
        if (compare && version !== null && picked.versionId !== version.versionId) {
            setBaseId(picked.versionId);
            return;
        }
        const next = picked.versionId === latest.versionId ? null : picked.versionId;
        if (pin === undefined) {
            selectArtifactVersion(artifact.artifactId, next, machineId);
        } else {
            pin.set(next);
        }
    };

    return (
        <div className="flex min-h-0 min-w-0 grow flex-col">
            <ArtifactToolbar>
                <IconButton icon={Info} size="sm" label={t('view.info')} aria-pressed={infoOpen} onClick={() => setInfoOpen(!infoOpen)} />
            </ArtifactToolbar>
            <div className="flex min-h-0 grow">
                <VersionsColumn
                    versions={versions}
                    selected={version}
                    base={base}
                    compare={compare}
                    onPick={pick}
                    onRemove={canRemove ? askRemove : undefined}
                />
                <div className="flex min-h-0 min-w-0 grow flex-col">
                    {version === null ? (
                        <Centered icon={Package}>
                            <span className="flex flex-col gap-1">
                                <span className="text-text">{t('view.versionGone')}</span>
                                <span>{t('view.versionGoneDetail')}</span>
                            </span>
                        </Centered>
                    ) : (
                        <ErrorBoundary label={t('view.failed')} resetKeys={[version.versionId, base?.versionId ?? '']} className="min-h-0 grow">
                            {compare && base !== null ? (
                                <CompareBody endpointId={endpointId} artifact={artifact} version={version} base={base} />
                            ) : (
                                <VersionBody endpointId={endpointId} artifact={artifact} version={version} />
                            )}
                        </ErrorBoundary>
                    )}
                </div>
                {infoOpen && version !== null && (
                    <InfoColumn endpointId={endpointId} artifact={artifact} version={version} latest={latest} chatPresent={result.chatPresent}>
                        <Tooltip label={t('view.compareOff')} disabled={canCompare}>
                            <ActionRow
                                icon={GitCompare}
                                aria-pressed={compare}
                                aria-disabled={!canCompare}
                                onClick={() => canCompare && setComparing(!comparing)}
                            >
                                {t('view.compare')}
                            </ActionRow>
                        </Tooltip>
                        {machineId === undefined ? (
                            <>
                                <ActionRow icon={FilePlus} onClick={() => setCopy({ version, open: true, round: (copy?.round ?? 0) + 1 })}>
                                    {t('view.copyToProject')}
                                </ActionRow>
                                <PinToCanvas artifact={artifact} version={version.versionId === latest.versionId ? null : version.versionId} />
                                {canRemove && (
                                    <ActionRow icon={Trash2} onClick={() => askRemove(null)}>
                                        {t('remove.action')}
                                    </ActionRow>
                                )}
                            </>
                        ) : (
                            <CopyToThisMachine machineId={machineId} artifact={artifact} version={version} />
                        )}
                    </InfoColumn>
                )}
            </div>
            {machineId === undefined && (
                <LazyBoundary>
                    <CopyToProjectDialog
                        endpointId={endpointId}
                        artifact={artifact}
                        request={copy}
                        onClose={() => copy !== null && setCopy({ ...copy, open: false })}
                    />
                </LazyBoundary>
            )}
            <RemoveArtifactDialog endpointId={endpointId} request={removing} onClose={() => removing !== null && setRemoving({ ...removing, open: false })} />
        </div>
    );
}

/* Pin to canvas as a row of the actions, with the version picked unless that is the latest, which the node then follows. */
function PinToCanvas({ artifact, version }: { artifact: Artifact; version: string | null }) {
    const { t } = useTranslation('output');
    const canvases = usePinCanvases();
    return (
        <Menu.Root>
            <Menu.Trigger render={<ActionRow icon={Pin} disabled={canvases.length === 0} />}>{t('view.pinToCanvas')}</Menu.Trigger>
            <Menu.Popup align="start" className="min-w-48">
                {canvases.map((view) => (
                    <Menu.Item key={view.id} onClick={() => void pinArtifact(artifact, version, view.id)}>
                        <span className="truncate">{view.name}</span>
                    </Menu.Item>
                ))}
            </Menu.Popup>
        </Menu.Root>
    );
}

/* The version Compare sets beside the one picked: the one a person chose, or the one before it. */
function baseFor(versions: readonly ArtifactVersion[], version: ArtifactVersion | null, baseId: string | null): ArtifactVersion | null {
    if (version === null) {
        return null;
    }
    const chosen = versions.find((entry) => entry.versionId === baseId && entry.versionId !== version.versionId && comparable(entry));
    if (chosen !== undefined) {
        return chosen;
    }
    const index = versions.indexOf(version);
    return versions.slice(index + 1).find(comparable) ?? versions.find((entry) => entry !== version && comparable(entry)) ?? null;
}

/* The view's controls go up into the bar of its cell, the way a file's do; a cell without one gets a bar of its own. */
function ArtifactToolbar({ children }: { children: ReactNode }) {
    const { host } = useFileToolbarSlot();
    if (host !== null) {
        return createPortal(children, host);
    }
    return (
        <div className={FILE_TOOLBAR}>
            <span className="grow" />
            {children}
        </div>
    );
}

function VersionsColumn({
    versions,
    selected,
    base,
    compare,
    onPick,
    onRemove
}: {
    versions: readonly ArtifactVersion[];
    selected: ArtifactVersion | null;
    base: ArtifactVersion | null;
    compare: boolean;
    onPick(version: ArtifactVersion): void;
    /* Set where a person may remove a version, which a right click on its row offers. */
    onRemove?: (version: ArtifactVersion) => void;
}) {
    const { t } = useTranslation('output');
    return (
        <nav className="flex w-60 shrink-0 flex-col border-r border-border" aria-label={t('view.versions')}>
            <div className="flex h-10 shrink-0 items-center gap-2 px-4">
                <SectionLabel>{t('view.versions')}</SectionLabel>
                <span className="text-xs text-text-faint tabular-nums">{versions.length}</span>
                <span className="grow" />
                {compare && <span className="text-xs text-text-faint">{t('view.pickBase')}</span>}
            </div>
            <div className="flex min-h-0 grow flex-col gap-0.5 overflow-y-auto px-2 pb-2">
                {versions.map((version, index) => {
                    const isSelected = selected?.versionId === version.versionId;
                    const isBase = base?.versionId === version.versionId;
                    const row = (
                        <button
                            key={version.versionId}
                            type="button"
                            aria-current={isSelected ? 'true' : undefined}
                            className={`flex h-8 shrink-0 items-center gap-2 rounded-md px-2 text-left text-sm ${isSelected ? 'bg-surface-active text-text' : 'text-text-muted hover:bg-surface-hover'} ${isBase ? 'inset-ring inset-ring-border-strong' : ''}`}
                            onClick={() => onPick(version)}
                        >
                            <span className="truncate tabular-nums">
                                {t('view.versionRow', { number: version.number, date: formatDayClock(version.createdAt) })}
                            </span>
                            <span className="grow" />
                            {index === 0 && <Pill size="sm">{t('view.latest')}</Pill>}
                            {isBase && <Pill size="sm">{t('view.base')}</Pill>}
                            {!compare && index !== 0 && <span className="shrink-0 text-xs text-text-faint tabular-nums">{formatBytes(version.bytes)}</span>}
                        </button>
                    );
                    if (onRemove === undefined) {
                        return row;
                    }
                    return (
                        <ContextMenu.Root key={version.versionId}>
                            <ContextMenu.Trigger render={row} />
                            <ContextMenu.Popup>
                                <ContextMenu.Item className="text-status-error" onClick={() => onRemove(version)}>
                                    <Icon icon={Trash2} size={14} /> {t('remove.version')}
                                </ContextMenu.Item>
                            </ContextMenu.Popup>
                        </ContextMenu.Root>
                    );
                })}
            </div>
        </nav>
    );
}

function refOf(artifact: Artifact, version: ArtifactVersion, file: number): ArtifactFileRef {
    return { artifactId: artifact.artifactId, versionId: version.versionId, file };
}

/* What a version holds, drawn the way its kind reads best; an artifact node on a canvas draws the same. */
export function VersionBody({ endpointId, artifact, version }: { endpointId: string; artifact: Artifact; version: ArtifactVersion }) {
    const kind = drawnKind(artifact.kind);
    const first = version.files[0]!;
    if (kind === 'report' && isTextMime(first.mime)) {
        return <ReportBody endpointId={endpointId} artifact={artifact} version={version} />;
    }
    if (kind === 'image' && version.files.some((file) => file.mime.startsWith('image/'))) {
        return <ImagesBody endpointId={endpointId} artifact={artifact} version={version} />;
    }
    if (kind === 'page' && first.mime === 'text/html') {
        return <PageBody endpointId={endpointId} artifact={artifact} version={version} />;
    }
    return <FilesBody endpointId={endpointId} artifact={artifact} version={version} />;
}

function ReportBody({ endpointId, artifact, version }: { endpointId: string; artifact: Artifact; version: ArtifactVersion }) {
    const { t } = useTranslation('output');
    const file = version.files[0]!;
    const text = useArtifactText(endpointId, refOf(artifact, version, 0), file);
    if (text.status === 'loading') {
        return <Centered busy>{t('view.loading')}</Centered>;
    }
    if (text.status === 'failed') {
        return <Centered icon={CircleAlert}>{t('view.readFailed')}</Centered>;
    }
    return (
        <div className="min-h-0 grow overflow-y-auto px-8 py-6 select-text">
            {file.mime === 'text/markdown' ? (
                <FileMarkdown text={text.text} />
            ) : (
                <pre className="font-mono text-sm whitespace-pre-wrap text-text">{text.text}</pre>
            )}
        </div>
    );
}

function CompareBody({ endpointId, artifact, version, base }: { endpointId: string; artifact: Artifact; version: ArtifactVersion; base: ArtifactVersion }) {
    const { t } = useTranslation('output');
    const file = version.files[0]!;
    const next = useArtifactText(endpointId, refOf(artifact, version, 0), file);
    const old = useArtifactText(endpointId, refOf(artifact, base, 0), base.files[0]!);
    if (next.status === 'loading' || old.status === 'loading') {
        return <Centered busy>{t('view.loading')}</Centered>;
    }
    if (next.status === 'failed' || old.status === 'failed') {
        return <Centered icon={CircleAlert}>{t('view.readFailed')}</Centered>;
    }
    const patch = patchOf(old.text, next.text);
    const lines = patch.hunks.flatMap((hunk) => hunk.lines);
    const added = lines.filter((line) => line.kind === 'insert').length;
    const removed = lines.filter((line) => line.kind === 'delete').length;
    return (
        <div className="flex min-h-0 grow flex-col">
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-4 text-xs text-text-muted">
                <span className="tabular-nums">{t('view.versionRow', { number: base.number, date: formatDayClock(base.createdAt) })}</span>
                <span aria-hidden="true">›</span>
                <span className="text-text tabular-nums">{t('view.versionRow', { number: version.number, date: formatDayClock(version.createdAt) })}</span>
                <span className="grow" />
                <span className="text-positive tabular-nums">+{added}</span>
                <span className="text-status-error tabular-nums">-{removed}</span>
            </div>
            {patch.hunks.length === 0 ? (
                <Centered icon={GitCompare}>{t('view.noChange')}</Centered>
            ) : (
                <div className="file-diff flex min-h-0 grow flex-col overflow-auto">
                    <LazyBoundary>
                        <UnifiedDiff
                            change={{ path: file.name, kind: 'update', diff: patch.text }}
                            contents={{ old: old.text, new: next.text }}
                            overflow="wrap"
                            fill
                        />
                    </LazyBoundary>
                </div>
            )}
        </div>
    );
}

function ImagesBody({ endpointId, artifact, version }: { endpointId: string; artifact: Artifact; version: ArtifactVersion }) {
    return (
        <div className="flex min-h-0 grow flex-col items-center gap-4 overflow-auto bg-surface-sunken p-4">
            {version.files.map((file, index) =>
                file.mime.startsWith('image/') ? (
                    <ArtifactImage key={index} endpointId={endpointId} reference={refOf(artifact, version, index)} name={file.name} />
                ) : null
            )}
        </div>
    );
}

function ArtifactImage({ endpointId, reference, name }: { endpointId: string; reference: ArtifactFileRef; name: string }) {
    const bytes = useMachineUrl({ kind: 'artifact', ...reference }, endpointId);
    return bytes.url === null ? null : <img src={bytes.url} alt={name} className="max-w-full object-contain" />;
}

/* A page in the same sandboxed frame a chat draws a visual in, never on the app's own origin. */
function PageBody({ endpointId, artifact, version }: { endpointId: string; artifact: Artifact; version: ArtifactVersion }) {
    const file = version.files[0]!;
    const reference = refOf(artifact, version, 0);
    const page = (): Promise<string> => readArtifactFile(endpointId, reference, file).then((blob) => blob.text());
    return (
        <div className="relative min-h-0 grow">
            <VisualPageFrame key={version.versionId} page={page} title={artifact.title} fill />
        </div>
    );
}

function FilesBody({ endpointId, artifact, version }: { endpointId: string; artifact: Artifact; version: ArtifactVersion }) {
    const { t } = useTranslation('output');
    return (
        <div className="flex min-h-0 grow flex-col overflow-y-auto px-6 py-6">
            <p className="mb-4 text-sm text-text-muted">{t('view.noPreview')}</p>
            <FileRows endpointId={endpointId} artifact={artifact} version={version} />
        </div>
    );
}

function FileRows({ endpointId, artifact, version }: { endpointId: string; artifact: Artifact; version: ArtifactVersion }) {
    const { t } = useTranslation('output');
    const download = (index: number): void => {
        downloadArtifactFile(endpointId, refOf(artifact, version, index), version.files[index]!).catch((error: unknown) =>
            useToasts.getState().show({ kind: 'error', title: t('view.downloadFailed'), description: error instanceof Error ? error.message : String(error) })
        );
    };
    return (
        <ul className="flex flex-col">
            {version.files.map((file, index) => (
                <li key={index} className="flex h-8 items-center gap-2 text-sm">
                    <span className="min-w-0 grow truncate text-text">{file.name}</span>
                    <span className="shrink-0 text-xs text-text-faint tabular-nums">{formatBytes(file.size)}</span>
                    {/* A download is read whole into this window first, and nothing on the desktop bridge writes a machine's file to disk in pieces. */}
                    {file.size > BYTES_READ_MAX_BYTES ? (
                        <IconButton
                            icon={Download}
                            size="sm"
                            label={t('view.downloadTooLarge', { size: formatBytes(BYTES_READ_MAX_BYTES) })}
                            aria-disabled
                            onClick={() => undefined}
                        />
                    ) : (
                        <IconButton icon={Download} size="sm" label={t('view.download')} onClick={() => download(index)} />
                    )}
                </li>
            ))}
        </ul>
    );
}

function InfoColumn({
    endpointId,
    artifact,
    version,
    latest,
    chatPresent,
    children
}: {
    endpointId: string;
    artifact: Artifact;
    version: ArtifactVersion;
    latest: ArtifactVersion;
    chatPresent: boolean;
    /* What a person does with the version shown, in a list at the foot of the column. */
    children: ReactNode;
}) {
    const { t } = useTranslation('output');
    const provenance = version.provenance;
    const chatId = provenance.chatId;
    const chatName = useChatName(chatId);
    const listed = useChats((s) => chatId !== undefined && s.statusByKey[endpointKey(endpointId, chatId)] !== undefined);
    const present = chatName !== null || listed || (chatId !== undefined && chatId === latest.provenance.chatId && chatPresent);
    const machine = useEndpoints((s) => s.endpoints.find((entry) => entry.id === endpointId)?.label ?? '');
    const originId = version.origin?.machineId;
    const origin = useEndpoints((s) =>
        originId === undefined ? null : (s.endpoints.find((entry) => entry.id === originId || entry.daemonId === originId)?.label ?? null)
    );
    return (
        <aside className="flex w-72 shrink-0 flex-col border-l border-border" aria-label={t('view.info')}>
            <div className="flex min-h-0 grow flex-col gap-5 overflow-y-auto px-4 py-3">
                <div className="flex flex-col gap-3">
                    <SectionLabel render={<h3 />}>{t('view.info')}</SectionLabel>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                        <InfoRow label={t('info.maker')}>
                            <Maker endpointId={endpointId} provenance={provenance} />
                        </InfoRow>
                        {chatId !== undefined && (
                            <InfoRow label={t('info.chat')}>
                                {chatName !== null ? (
                                    <button type="button" className="truncate text-left text-text hover:underline" onClick={() => showChat(chatId)}>
                                        {chatName === '' ? t('info.chatElsewhere') : chatName}
                                    </button>
                                ) : present ? (
                                    t('info.chatElsewhere')
                                ) : (
                                    <span className="text-text-muted">{t('info.chatRemoved')}</span>
                                )}
                            </InfoRow>
                        )}
                        <InfoRow label={t('info.machine')}>{machine}</InfoRow>
                        {originId !== undefined && <InfoRow label={t('info.copiedFrom')}>{origin ?? t('info.otherMachine')}</InfoRow>}
                    </dl>
                    <p className="flex gap-2 rounded-md bg-surface-sunken px-3 py-2 text-xs text-text-muted">
                        <Icon icon={Lock} size={14} className="mt-0.5 shrink-0 text-text-faint" />
                        <span>{t('info.note')}</span>
                    </p>
                </div>
                <div className="flex flex-col gap-2">
                    <SectionLabel render={<h3 />}>{t('view.files')}</SectionLabel>
                    <FileRows endpointId={endpointId} artifact={artifact} version={version} />
                </div>
                {version.copiedTo.length > 0 && (
                    <div className="flex flex-col gap-2">
                        <SectionLabel render={<h3 />}>{t('info.copiedTo')}</SectionLabel>
                        <ul className="flex flex-col gap-1 text-xs text-text-muted">
                            {version.copiedTo.map((path) => (
                                <li key={path} className="truncate font-mono">
                                    {path}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
            <div className="flex shrink-0 flex-col gap-0.5 border-t border-border p-2">{children}</div>
        </aside>
    );
}

/*
 * Who made a version: a person, a routine, or an agent by its CLI's mark and the model it ran, named
 * the way the machine's catalog names it. A version saved before the machine noted either says Agent.
 */
function Maker({ endpointId, provenance }: { endpointId: string; provenance: ArtifactProvenance }) {
    const { t } = useTranslation('output');
    const { agent, model } = provenance;
    const catalog = useProvidersStore((s) => (agent === undefined ? undefined : s.byScope[endpointId]?.providers.find((entry) => entry.kind === agent)));
    if (provenance.maker !== 'agent' || (agent === undefined && model === undefined)) {
        return t(`info.makers.${provenance.maker}`);
    }
    const name = model === undefined ? (catalog?.name ?? t('info.makers.agent')) : modelName(model, catalog?.models);
    return (
        <span className="flex min-w-0 items-center gap-1.5">
            {agent !== undefined &&
                (hasProviderLogo(agent) ? <ProviderLogo provider={agent} size={14} /> : <AgentIcon kind={agent} size={14} className="shrink-0" />)}
            <span className="truncate">{name}</span>
        </span>
    );
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
    return (
        <>
            <dt className="text-text-faint">{label}</dt>
            <dd className="min-w-0 truncate text-text">{children}</dd>
        </>
    );
}
