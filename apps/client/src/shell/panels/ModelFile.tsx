import { revealFile } from './reveal-file';
import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, CornerUpRight, Grid3x3, Pause, Play, RotateCcw } from 'lucide-react';
import { BYTES_READ_MAX_BYTES, type FsReadBinary } from '@ruimte/contracts';
import { useEndpointId } from '@/state/keys';
import { fileManagerName, useServer } from '@/state/server';
import { useTransport } from '@/transport/context';
import { readMachineFile } from '@/transport/machine-url';
import { FileContextMenu, FileToolbar, FileToolbarToggle } from '@/shell/panels/FileToolbar';
import { canDrawWebgl, ModelViewer, type LoadedModel } from '@/shell/panels/model-viewer';
import { Button, ButtonGroup, EmptyState, Icon, IconButton } from '@adecore/ui';
import { formatBytes, formatNumber } from '@adecore/ui/format';

type Phase = { kind: 'loading' } | { kind: 'ready'; model: LoadedModel } | { kind: 'failed'; reason: string } | { kind: 'no-webgl' };

const LOADING: Phase = { kind: 'loading' };
const NO_WEBGL: Phase = { kind: 'no-webgl' };

function messageOf(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

/* A binary glTF or a USDZ package, drawn in 3D on the same plain surface as an image. */
export function ModelFile({ path, name, read }: { path: string; name: string; read: FsReadBinary }) {
    const { t } = useTranslation('panels');
    const platform = useServer((s) => s.platform);
    const transport = useTransport();
    const endpointId = useEndpointId();
    const hostRef = useRef<HTMLDivElement>(null);
    const viewerRef = useRef<ModelViewer | null>(null);
    const key = JSON.stringify([endpointId, path, read.mtime, read.size]);
    const [held, setHeld] = useState<{ key: string; phase: Phase } | null>(null);
    const [wireframe, setWireframe] = useState(false);
    const [playing, setPlaying] = useState(false);
    const phase = !canDrawWebgl() ? NO_WEBGL : held !== null && held.key === key ? held.phase : LOADING;
    const ready = phase.kind === 'ready';

    useEffect(() => {
        const host = hostRef.current;
        if (host === null || !canDrawWebgl()) {
            return;
        }
        let cancelled = false;
        // Made once the bytes are in, so a slow machine does not hold a context for a canvas nobody sees yet.
        let viewer: ModelViewer | null = null;
        readMachineFile(endpointId, { path, mtime: read.mtime, size: read.size }, BYTES_READ_MAX_BYTES)
            .then((bytes) => {
                if (cancelled) {
                    return null;
                }
                viewer = new ModelViewer(host);
                viewerRef.current = viewer;
                return viewer.load(bytes, read.mime, t('file.model.nestedRoot'));
            })
            .then(
                (model) => {
                    if (model !== null && !cancelled) {
                        setHeld({ key, phase: { kind: 'ready', model } });
                    }
                },
                (e: unknown) => {
                    // Nothing left to draw, so the context goes back now rather than when the tab closes.
                    viewer?.dispose();
                    if (!cancelled) {
                        setHeld({ key, phase: { kind: 'failed', reason: messageOf(e) } });
                    }
                }
            );
        return () => {
            cancelled = true;
            viewer?.dispose();
            if (viewerRef.current === viewer) {
                viewerRef.current = null;
            }
        };
    }, [key, endpointId, path, read.mtime, read.size, read.mime, t]);

    useEffect(() => {
        if (ready) {
            viewerRef.current?.setWireframe(wireframe);
        }
    }, [ready, wireframe]);

    useEffect(() => {
        if (ready) {
            viewerRef.current?.setPlaying(playing);
        }
    }, [ready, playing]);

    const reveal = (): void => {
        revealFile(transport, path);
    };

    const revealAction = (
        <Button variant="secondary" size="sm" onClick={reveal}>
            <Icon icon={CornerUpRight} size={14} /> {t('file.revealIn', { app: fileManagerName(platform) })}
        </Button>
    );

    const overlay = (): React.ReactNode => {
        if (phase.kind === 'loading') {
            return <EmptyState busy>{t('file.reading', { name })}</EmptyState>;
        }
        if (phase.kind === 'failed') {
            return (
                <EmptyState className="select-text" icon={Box} action={revealAction}>
                    {t('file.model.failed', { name, reason: phase.reason })}
                </EmptyState>
            );
        }
        if (phase.kind === 'no-webgl') {
            return (
                <EmptyState className="select-text" icon={Box} action={revealAction}>
                    {t('file.model.noWebgl', { name })}
                </EmptyState>
            );
        }
        return null;
    };

    return (
        <div className="flex min-h-0 min-w-0 grow flex-col">
            {phase.kind === 'ready' ? (
                <FileToolbar>
                    <ButtonGroup>
                        <IconButton icon={RotateCcw} size="sm" label={t('file.model.resetCamera')} onClick={() => viewerRef.current?.resetCamera()} />
                        <FileToolbarToggle icon={Grid3x3} label={t('file.model.wireframe')} active={wireframe} onClick={() => setWireframe(!wireframe)} />
                        {phase.model.animated && (
                            <IconButton
                                icon={playing ? Pause : Play}
                                size="sm"
                                label={playing ? t('file.model.pause') : t('file.model.play')}
                                onClick={() => setPlaying(!playing)}
                            />
                        )}
                    </ButtonGroup>
                </FileToolbar>
            ) : (
                <FileToolbar />
            )}
            <FileContextMenu className="relative min-h-0 grow overflow-hidden bg-surface-sunken">
                <div ref={hostRef} className={clsx('absolute inset-0', !ready && 'invisible')} />
                {!ready && <div className="absolute inset-0 grid place-items-center overflow-auto p-4">{overlay()}</div>}
            </FileContextMenu>
            <div className="flex h-7 shrink-0 items-center gap-3 border-t border-border px-2 text-xs text-text-muted select-text">
                {phase.kind === 'ready' && (
                    <>
                        <span>{t('file.model.vertices', { count: phase.model.vertices, value: formatNumber(phase.model.vertices) })}</span>
                        <span>{t('file.model.triangles', { count: phase.model.triangles, value: formatNumber(phase.model.triangles) })}</span>
                    </>
                )}
                <span>{formatBytes(read.size)}</span>
                <span>{read.mime}</span>
            </div>
        </div>
    );
}
