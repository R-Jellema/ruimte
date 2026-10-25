import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { CircleAlert, Download, FilePlus, GitCompare, Info, Lock, Package, WifiOff } from 'lucide-react';
import { patchOf } from '@adecore/merge';
import { VisualPageFrame } from '@adecore/agents-react/chat/ui';
import { useChats } from '@adecore/agents-react/state';
import type { Artifact, ArtifactGetResult, ArtifactVersion } from '@ruimte/contracts';
import { Button, EmptyState, ErrorBoundary, Icon, IconButton, LazyBoundary, Pill, SectionLabel, Separator, lazyNamed, Tooltip } from '@adecore/ui';
import { formatBytes, formatDayClock } from '@adecore/ui/format';
import { comparable, drawnKind, isTextMime } from '@/output/artifact-list';
import { downloadArtifactFile, readArtifactFile, useArtifactText, type ArtifactFileRef } from '@/output/artifact-bytes';
import { showChat, useChatName } from '@/output/kinds';
import { selectArtifactVersion, useArtifactSelection } from '@/output/open';
import { useArtifact } from '@/output/use-artifact';
import { FileMarkdown } from '@/shell/panels/FileMarkdown';
import { FILE_TOOLBAR } from '@/shell/panels/classes';
import { useFileToolbarSlot } from '@/shell/panels/file-toolbar-slot';
import { useEndpoints } from '@/state/endpoints';
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
export function ArtifactView({ artifactId }: { artifactId: string }) {
    const { t } = useTranslation('output');
    const endpointId = useEndpointId();
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
    if (state.status === 'gone') {
        return <Centered icon={Package}>{t('view.gone')}</Centered>;
    }
    return <ArtifactBody endpointId={endpointId} result={state.result} />;
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

function ArtifactBody({ endpointId, result }: { endpointId: string; result: ArtifactGetResult }) {
    const { t } = useTranslation('output');
    const { artifact, versions } = result;
    const chosen = useArtifactSelection((s) => s.versions[artifactTabKey(artifact.artifactId)] ?? null);
    const [comparing, setComparing] = useState(false);
    const [baseId, setBaseId] = useState<string | null>(null);
    const [infoOpen, setInfoOpen] = useState(true);
    const [copying, setCopying] = useState(false);
    const latest = versions[0]!;
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
        selectArtifactVersion(artifact.artifactId, picked.versionId === latest.versionId ? null : picked.versionId);
    };

    return (
        <div className="flex min-h-0 min-w-0 grow flex-col">
            <ArtifactToolbar>
                <Tooltip label={t('view.compareOff')} disabled={canCompare}>
                    <Button size="sm" aria-pressed={compare} aria-disabled={!canCompare} onClick={() => canCompare && setComparing(!comparing)}>
                        <Icon icon={GitCompare} size={14} /> {t('view.compare')}
                    </Button>
                </Tooltip>
                <Button size="sm" disabled={version === null} onClick={() => setCopying(true)}>
                    <Icon icon={FilePlus} size={14} /> {t('view.copyToProject')}
                </Button>
                <Separator />
                <IconButton icon={Info} size="sm" label={t('view.info')} aria-pressed={infoOpen} onClick={() => setInfoOpen(!infoOpen)} />
            </ArtifactToolbar>
            <div className="flex min-h-0 grow">
                <VersionsColumn versions={versions} selected={version} base={base} compare={compare} onPick={pick} />
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
                    <InfoColumn endpointId={endpointId} artifact={artifact} version={version} latest={latest} chatPresent={result.chatPresent} />
                )}
            </div>
            {copying && version !== null && (
                <LazyBoundary>
                    <CopyToProjectDialog endpointId={endpointId} artifact={artifact} version={version} onClose={() => setCopying(false)} />
                </LazyBoundary>
            )}
        </div>
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
    onPick
}: {
    versions: readonly ArtifactVersion[];
    selected: ArtifactVersion | null;
    base: ArtifactVersion | null;
    compare: boolean;
    onPick(version: ArtifactVersion): void;
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
                    return (
                        <button
                            key={version.versionId}
                            type="button"
                            aria-current={isSelected ? 'true' : undefined}
                            className={`flex h-8 shrink-0 items-center gap-2 rounded-md px-2 text-left text-sm ${isSelected ? 'bg-surface-active text-text' : 'text-text-muted hover:bg-surface-hover'} ${isBase ? 'inset-ring inset-ring-border-strong' : ''}`}
                            onClick={() => onPick(version)}
                        >
                            <span className="truncate tabular-nums">{formatDayClock(version.createdAt)}</span>
                            <span className="grow" />
                            {index === 0 && (
                                <Pill tone="accent" size="sm">
                                    {t('view.latest')}
                                </Pill>
                            )}
                            {isBase && <Pill size="sm">{t('view.base')}</Pill>}
                            {!compare && index !== 0 && <span className="shrink-0 text-xs text-text-faint tabular-nums">{formatBytes(version.bytes)}</span>}
                        </button>
                    );
                })}
            </div>
        </nav>
    );
}

function refOf(artifact: Artifact, version: ArtifactVersion, file: number): ArtifactFileRef {
    return { artifactId: artifact.artifactId, versionId: version.versionId, file };
}

/* What a version holds, drawn the way its kind reads best. */
function VersionBody({ endpointId, artifact, version }: { endpointId: string; artifact: Artifact; version: ArtifactVersion }) {
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
                <span className="tabular-nums">{formatDayClock(base.createdAt)}</span>
                <span aria-hidden="true">›</span>
                <span className="text-text tabular-nums">{formatDayClock(version.createdAt)}</span>
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
                    <IconButton icon={Download} size="sm" label={t('view.download')} onClick={() => download(index)} />
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
    chatPresent
}: {
    endpointId: string;
    artifact: Artifact;
    version: ArtifactVersion;
    latest: ArtifactVersion;
    chatPresent: boolean;
}) {
    const { t } = useTranslation('output');
    const provenance = version.provenance;
    const chatId = provenance.chatId;
    const chatName = useChatName(chatId);
    const listed = useChats((s) => chatId !== undefined && s.statusByKey[endpointKey(endpointId, chatId)] !== undefined);
    const present = chatName !== null || listed || (chatId !== undefined && chatId === latest.provenance.chatId && chatPresent);
    const machine = useEndpoints((s) => s.endpoints.find((entry) => entry.id === endpointId)?.label ?? '');
    return (
        <aside className="flex w-72 shrink-0 flex-col gap-5 overflow-y-auto border-l border-border px-4 py-3" aria-label={t('view.info')}>
            <div className="flex flex-col gap-3">
                <SectionLabel render={<h3 />}>{t('view.info')}</SectionLabel>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                    <InfoRow label={t('info.maker')}>{t(`info.makers.${provenance.maker}`)}</InfoRow>
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
                    {provenance.turnId !== undefined && <InfoRow label={t('info.turn')}>{shortId(provenance.turnId)}</InfoRow>}
                    {provenance.taskId !== undefined && <InfoRow label={t('info.task')}>{shortId(provenance.taskId)}</InfoRow>}
                    <InfoRow label={t('info.machine')}>{machine}</InfoRow>
                    {artifact.key !== undefined && (
                        <InfoRow label={t('info.key')}>
                            <span className="font-mono">{artifact.key}</span>
                        </InfoRow>
                    )}
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
            <div className="flex flex-col gap-2">
                <SectionLabel render={<h3 />}>{t('info.kept')}</SectionLabel>
                <p className="text-sm text-text-muted">{t('info.keptText')}</p>
            </div>
        </aside>
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

// An id says nothing to a person; its first characters tell two apart.
function shortId(id: string): string {
    return id.length > 12 ? id.slice(0, 12) : id;
}
