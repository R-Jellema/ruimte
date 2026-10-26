import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { Archive, ChevronsDownUp, CircleAlert, Package, SquareArrowOutUpRight, WifiOff } from 'lucide-react';
import type { RoutineRun } from '@ruimte/contracts';
import { ButtonGroup, EmptyState, ErrorBoundary, Icon, IconButton, Pill } from '@adecore/ui';
import { formatClock, formatDateTime, formatElapsedShort } from '@adecore/ui/format';
import { DerivedSet, type DerivedCard } from '@/canvas/DerivedSet';
import { VersionBody } from '@/output/ArtifactView';
import { openArtifact } from '@/output/open';
import { useArtifact } from '@/output/use-artifact';
import { lookOfRun, type BlockLook } from '@/routines/agenda';
import { besideLayout, type BesideCard } from '@/routines/beside-layout';
import { LookIcon } from '@/routines/look';
import { OutputShownBesideContext } from '@/output/chat-scope';
import { RoutineRunChat } from '@/routines/RoutineRunChat';
import { useRoutineList } from '@/routines/routine-list';
import { showRoutine } from '@/routines/stage';
import { runWords } from '@/routines/words';
import { OUTPUT_MIN, storedOutputSize, type CardSize } from '@/routines/output-size';
import { useCanvas, useCanvasStore } from '@/state/canvas';
import { useEndpointId } from '@/state/keys';
import { useProject } from '@/state/project';
import { useMachineAnswers } from '@/transport/features';

const FRAME = 'flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface bg-clip-padding shadow-node';
const HEADER = 'flex h-[39px] shrink-0 items-center gap-2 border-b border-border bg-surface-raised pr-1 pl-3 text-sm text-text';

const DOT: Record<BlockLook, string> = {
    done: 'bg-positive',
    waited: 'bg-positive',
    'caught-up': 'bg-positive',
    waiting: 'bg-status-needs-you',
    running: 'bg-accent',
    limit: 'bg-status-error',
    failed: 'bg-status-error',
    skipped: 'border border-border-strong',
    paused: 'border border-border-strong',
    next: 'border border-border-strong'
};

/*
 * A routine node's runs and Output beside it on the canvas, read from the routine list and never
 * stored, so a run writes nothing to the project and a teammate sees the runs of their own machine.
 * A run's chat stays hidden and on no canvas: this only draws it.
 */
export function RoutineBeside({ id, z }: { id: string; z: number }) {
    const { t } = useTranslation('routines');
    const node = useCanvas((s) => s.nodes[id]);
    const projectId = useProject((s) => s.current?.projectId ?? null);
    const endpointId = useEndpointId();
    const list = useRoutineList(endpointId);
    const viewId = useCanvas((s) => s.viewId);
    // Which run is open is this window's alone, like the scroll of a node: undefined opens the newest, null none.
    const [picked, setPicked] = useState<string | null | undefined>(undefined);
    const [outputSize, setOutputSize] = useState<CardSize | null>(() => (viewId === null ? null : storedOutputSize(viewId, id).read()));
    if (node === undefined || list === null || list.status !== 'ready') {
        return null;
    }
    const entry = list.result.routines.find((candidate) => candidate.projectId === projectId && candidate.routine.id === node.routine);
    if (entry === undefined) {
        return null;
    }
    const timeZone = list.result.timeZone;
    const target = { projectId: entry.projectId, routineId: entry.routine.id };
    const cardContent = (card: BesideCard): { label: string; body: ReactNode } => {
        if (card.kind === 'older') {
            const label = t('beside.olderRuns', { count: card.count });
            return {
                label,
                body: (
                    <button
                        type="button"
                        className="flex h-full items-center gap-2 rounded-md px-3 text-xs text-text-muted hover:text-text"
                        onClick={() => showRoutine(target)}
                    >
                        <Icon icon={Archive} size={12} />
                        {label}
                    </button>
                )
            };
        }
        if (card.kind === 'output') {
            const fallback = card.fallback;
            const note =
                fallback === null
                    ? null
                    : fallback.run === null
                      ? t('beside.noVersion')
                      : t('beside.noVersionShowing', { date: runDay(fallback.run, timeZone) });
            return {
                label: t('beside.output'),
                body: (
                    <div className="group/output relative h-full">
                        <OutputCard endpointId={endpointId} artifactId={card.artifactId} versionId={card.versionId} note={note} />
                        <ResizeGrip
                            size={{ w: card.rect.w, h: card.rect.h }}
                            onResize={setOutputSize}
                            onDone={(size) => viewId !== null && storedOutputSize(viewId, id).write(size)}
                        />
                    </div>
                )
            };
        }
        const label = t('beside.runTitle', { title: entry.routine.title, date: runDay(card.run, timeZone) });
        return {
            label,
            body: card.open ? (
                <OpenRun
                    title={label}
                    run={card.run}
                    timeZone={timeZone}
                    artifactId={entry.artifactId}
                    onShow={() => showRoutine(target, card.run.runId)}
                    onCollapse={() => setPicked(null)}
                />
            ) : (
                <RunLine run={card.run} timeZone={timeZone} onOpen={() => setPicked(card.run.runId)} />
            )
        };
    };
    const cards = besideLayout(node, entry.runs, picked, entry.artifactId, outputSize).map((card): DerivedCard => {
        const content = cardContent(card);
        const linkedFrom = card.kind === 'older' ? null : card.kind === 'output' ? (card.from ?? 'node') : 'node';
        return { key: card.key, rect: card.rect, linkedFrom, label: content.label, content: content.body };
    });

    return <DerivedSet owner={id} z={z} cards={cards} />;
}

function runDay(run: RoutineRun, timeZone: string): string {
    return formatDateTime(run.due, { weekday: 'short', day: 'numeric', month: 'short', timeZone });
}

/* What a run says beside its time: how long it took when it simply ran, and what became of it otherwise. */
function RunMark({ run }: { run: RoutineRun }) {
    const { t } = useTranslation('routines');
    const look = lookOfRun(run);
    if (look === 'done') {
        return run.endedAt === undefined ? null : (
            <span className="shrink-0 text-xs text-text-muted tabular-nums">{formatElapsedShort(run.endedAt - run.at)}</span>
        );
    }
    const words = look === 'caught-up' ? t('beside.caughtUp') : look === 'waited' ? t('beside.waited') : t(`looks.${look}`);
    return <Pill icon={<LookIcon look={look} />}>{words}</Pill>;
}

function StateDot({ run }: { run: RoutineRun }) {
    const { t } = useTranslation('routines');
    const look = lookOfRun(run);
    return <span role="img" aria-label={t(`looks.${look}`)} className={clsx('size-2 shrink-0 rounded-full', DOT[look])} />;
}

function RunLine({ run, timeZone, onOpen }: { run: RoutineRun; timeZone: string; onOpen: () => void }) {
    return (
        <button
            type="button"
            aria-expanded={false}
            className={clsx(FRAME, 'flex-row items-center gap-2 px-3 text-left text-sm text-text hover:bg-surface-raised')}
            onClick={onOpen}
        >
            <span className="min-w-0 grow truncate">
                {runDay(run, timeZone)} <span className="text-text-muted">· {formatClock(run.at, timeZone)}</span>
            </span>
            <RunMark run={run} />
            <StateDot run={run} />
        </button>
    );
}

function OpenRun({
    title,
    run,
    timeZone,
    artifactId,
    onShow,
    onCollapse
}: {
    title: string;
    run: RoutineRun;
    timeZone: string;
    // The routine's Output, which its own card beside the run already shows, so the thread leaves it out.
    artifactId: string | undefined;
    onShow: () => void;
    onCollapse: () => void;
}) {
    const { t } = useTranslation('routines');
    const look = lookOfRun(run);
    return (
        <div className={FRAME}>
            <header className={HEADER}>
                <span className="min-w-0 grow truncate font-medium">{title}</span>
                {look !== 'done' && <RunMark run={run} />}
                <StateDot run={run} />
                <ButtonGroup render={<span />}>
                    <IconButton icon={SquareArrowOutUpRight} size="sm" label={t('beside.openRun')} onClick={onShow} />
                    <IconButton icon={ChevronsDownUp} size="sm" label={t('beside.collapse')} aria-expanded onClick={onCollapse} />
                </ButtonGroup>
            </header>
            {run.chatId !== undefined ? (
                <OutputShownBesideContext value={artifactId ?? null}>
                    <RoutineRunChat chatId={run.chatId} />
                </OutputShownBesideContext>
            ) : (
                <div className="grid grow place-items-center px-4">
                    <EmptyState>{runWords(run, timeZone)}</EmptyState>
                </div>
            )}
        </div>
    );
}

/* A version of the routine's Output artifact, drawn as the artifact node draws one; the newest when the one asked for is not there. */
function OutputCard({ endpointId, artifactId, versionId, note }: { endpointId: string; artifactId: string; versionId: string | null; note: string | null }) {
    const { t } = useTranslation('output');
    const { t: words } = useTranslation('routines');
    const answers = useMachineAnswers(endpointId, 'artifact.get');
    const state = useArtifact(endpointId, artifactId, answers);
    if (!answers || state.status !== 'ready') {
        const [icon, text] = !answers
            ? [CircleAlert, t('panel.tooOld')]
            : state.status === 'unreachable'
              ? [WifiOff, t('view.unreachable')]
              : state.status === 'gone'
                ? [Package, t('node.removed')]
                : [undefined, t('view.loading')];
        return (
            <div className={clsx(FRAME, 'place-items-center justify-center')}>
                <EmptyState icon={icon} busy={state.status === 'loading'}>
                    {text}
                </EmptyState>
            </div>
        );
    }
    const { artifact, versions } = state.result;
    const version = versions.find((candidate) => candidate.versionId === versionId) ?? versions[0]!;
    return (
        <div className={FRAME}>
            <header className={HEADER}>
                <Icon icon={Package} size={14} className="shrink-0 text-text-muted" />
                <span className="min-w-0 truncate font-medium">{artifact.title}</span>
                <Pill className="tabular-nums">{`v${version.number}`}</Pill>
                <span className="grow" />
                <IconButton
                    icon={SquareArrowOutUpRight}
                    size="sm"
                    label={words('detail.openInOutput')}
                    onClick={() => openArtifact(artifact.artifactId, artifact.title, version.versionId)}
                />
            </header>
            {note !== null && <p className="shrink-0 border-b border-border bg-surface-sunken px-3 py-1.5 text-xs text-text-muted">{note}</p>}
            <ErrorBoundary label={t('view.failed')} resetKeys={[version.versionId]} className="flex min-h-0 grow flex-col">
                <VersionBody endpointId={endpointId} artifact={artifact} version={version} />
            </ErrorBoundary>
        </div>
    );
}

/*
 * The corner a person drags to size the Output card, outside its frame as a node's resize handle is,
 * so the version keeps every pixel. A press here is the grip's alone, never the canvas's.
 */
function ResizeGrip({ size, onResize, onDone }: { size: CardSize; onResize: (size: CardSize) => void; onDone: (size: CardSize) => void }) {
    const { t } = useTranslation('routines');
    const canvasStore = useCanvasStore();
    const drag = useRef<{ x: number; y: number; start: CardSize; zoom: number; size: CardSize } | null>(null);
    return (
        <span
            role="separator"
            aria-label={t('beside.resize')}
            className="absolute -right-3 -bottom-3 size-4 cursor-nwse-resize rounded-br-md border-r-2 border-b-2 border-border-strong opacity-0 transition-opacity group-hover/output:opacity-100"
            onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                drag.current = { x: e.clientX, y: e.clientY, start: size, zoom: canvasStore.getState().camera.zoom, size };
            }}
            onPointerMove={(e) => {
                const held = drag.current;
                if (held === null) {
                    return;
                }
                held.size = {
                    w: Math.round(Math.max(OUTPUT_MIN.w, held.start.w + (e.clientX - held.x) / held.zoom)),
                    h: Math.round(Math.max(OUTPUT_MIN.h, held.start.h + (e.clientY - held.y) / held.zoom))
                };
                onResize(held.size);
            }}
            onPointerUp={() => {
                if (drag.current !== null) {
                    onDone(drag.current.size);
                    drag.current = null;
                }
            }}
            onPointerCancel={() => {
                drag.current = null;
            }}
        />
    );
}
