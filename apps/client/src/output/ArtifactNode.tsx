import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ChevronDown, CircleAlert, Maximize2, Package, WifiOff } from 'lucide-react';
import type { ArtifactGetResult, ProjectNode } from '@ruimte/contracts';
import { Button, EmptyState, ErrorBoundary, Icon, IconButton, Menu } from '@adecore/ui';
import { formatDayClock } from '@adecore/ui/format';
import { VersionBody } from '@/output/ArtifactView';
import { openArtifact } from '@/output/open';
import { useArtifact } from '@/output/use-artifact';
import { useFileToolbarSlot } from '@/shell/panels/file-toolbar-slot';
import { useCanvas, useCanvasStore } from '@/state/canvas';
import { useEndpointId } from '@/state/keys';
import { useMachineAnswers } from '@/transport/features';

type ArtifactReference = NonNullable<ProjectNode['artifact']>;

// A version id is the machine's and never empty, so the empty string is free to mean no version at all.
const FOLLOW_LATEST = '';

/*
 * An artifact of this machine's Output on a canvas. The reference is one person's on one machine and
 * lives in the private overlay, so a teammate's node arrives without it and says so. Without a version
 * the node follows the latest; with one it stays there and says when a newer one exists.
 */
export function ArtifactNodeBody({ id }: { id: string }) {
    const { t } = useTranslation('output');
    const reference = useCanvas((s) => s.nodes[id]?.artifact);
    if (reference === undefined) {
        return (
            <Plate icon={Package}>
                <span className="text-text">{t('node.notHere')}</span>
                <span>{t('node.notHereDetail')}</span>
            </Plate>
        );
    }
    return <ArtifactOnCanvas id={id} reference={reference} />;
}

function Plate({ icon, busy, children }: { icon?: typeof Package; busy?: boolean; children: ReactNode }) {
    return (
        <div className="grid h-full w-full place-items-center px-4">
            <EmptyState icon={icon} busy={busy}>
                <span className="flex flex-col gap-1">{children}</span>
            </EmptyState>
        </div>
    );
}

function ArtifactOnCanvas({ id, reference }: { id: string; reference: ArtifactReference }) {
    const { t } = useTranslation('output');
    const endpointId = useEndpointId();
    const answers = useMachineAnswers(endpointId, 'artifact.get');
    const state = useArtifact(endpointId, reference.id, answers);
    if (!answers) {
        return <Plate icon={CircleAlert}>{t('panel.tooOld')}</Plate>;
    }
    if (state.status === 'loading') {
        return <Plate busy>{t('view.loading')}</Plate>;
    }
    if (state.status === 'unreachable') {
        return <Plate icon={WifiOff}>{t('view.unreachable')}</Plate>;
    }
    if (state.status === 'gone') {
        return <Removed />;
    }
    return <ArtifactVersionOnCanvas id={id} endpointId={endpointId} reference={reference} result={state.result} />;
}

function Removed() {
    const { t } = useTranslation('output');
    return (
        <Plate icon={Package}>
            <span className="text-text">{t('node.removed')}</span>
            <span>{t('node.removedDetail')}</span>
        </Plate>
    );
}

function ArtifactVersionOnCanvas({
    id,
    endpointId,
    reference,
    result
}: {
    id: string;
    endpointId: string;
    reference: ArtifactReference;
    result: ArtifactGetResult;
}) {
    const { t } = useTranslation('output');
    const canvas = useCanvasStore();
    const { artifact, versions } = result;
    const latest = versions[0]!;
    const version = reference.version === undefined ? latest : versions.find((entry) => entry.versionId === reference.version);
    const pin = (versionId: string | null): void => {
        canvas.getState().updateNode(id, { artifact: { id: reference.id, ...(versionId === null ? {} : { version: versionId }) } }, true);
    };
    const controls = (
        <>
            <Menu.Root>
                <Menu.Trigger render={<Button size="xs" variant="secondary" />}>
                    {reference.version === undefined ? t('view.latest') : t('node.pinned', { number: version?.number ?? '?' })}
                    <Icon icon={ChevronDown} size={12} />
                </Menu.Trigger>
                <Menu.Popup align="end" className="max-h-80 min-w-56 overflow-y-auto">
                    <Menu.RadioGroup
                        value={reference.version ?? FOLLOW_LATEST}
                        onValueChange={(next: string) => pin(next === FOLLOW_LATEST ? null : next)}
                    >
                        <Menu.RadioItem value={FOLLOW_LATEST} closeOnClick>{t('node.follow')}</Menu.RadioItem>
                        <Menu.Separator />
                        {versions.map((entry) => (
                            <Menu.RadioItem key={entry.versionId} value={entry.versionId} className="tabular-nums" closeOnClick>
                                {t('node.version', { number: entry.number, date: formatDayClock(entry.createdAt) })}
                            </Menu.RadioItem>
                        ))}
                    </Menu.RadioGroup>
                </Menu.Popup>
            </Menu.Root>
            <IconButton
                icon={Maximize2}
                size="sm"
                label={t('node.open')}
                onClick={() => openArtifact(artifact.artifactId, artifact.title, reference.version ?? null)}
            />
        </>
    );
    return (
        <div className="flex h-full min-h-0 w-full flex-col">
            <HeaderControls>{controls}</HeaderControls>
            {version === undefined ? (
                <Removed />
            ) : (
                <>
                    <ErrorBoundary label={t('view.failed')} resetKeys={[version.versionId]} className="flex min-h-0 grow flex-col">
                        <VersionBody endpointId={endpointId} artifact={artifact} version={version} />
                    </ErrorBoundary>
                    <footer className="flex h-8 shrink-0 items-center gap-2 border-t border-border px-3 text-xs text-text-muted">
                        {version.versionId === latest.versionId ? (
                            <span className="truncate tabular-nums">
                                {t('node.version', { number: version.number, date: formatDayClock(version.createdAt) })}
                            </span>
                        ) : (
                            <>
                                <span className="grow truncate">{t('node.newer', { number: latest.number })}</span>
                                <Button size="xs" variant="ghost" onClick={() => pin(latest.versionId)}>
                                    {t('node.showIt')}
                                </Button>
                            </>
                        )}
                    </footer>
                </>
            )}
        </div>
    );
}

/* The node's header carries the version and the way to the full view, the way a file node's carries its controls. */
function HeaderControls({ children }: { children: ReactNode }) {
    const { host } = useFileToolbarSlot();
    return host === null ? null : createPortal(children, host);
}
