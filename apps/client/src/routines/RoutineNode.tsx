import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { CalendarClock, CircleAlert, CirclePause, Clock, Package, Pause, Play, SquareArrowOutUpRight, WifiOff } from 'lucide-react';
import type { RoutineEntry, RoutineRun } from '@ruimte/contracts';
import { Button, EmptyState, ErrorBoundary, Icon, IconButton, Pill, SectionLabel, Switch } from '@adecore/ui';
import { formatDateTime } from '@adecore/ui/format';
import { VersionBody } from '@/output/ArtifactView';
import { openArtifact } from '@/output/open';
import { useArtifact } from '@/output/use-artifact';
import { lookOfRun } from '@/routines/agenda';
import { blockClass } from '@/routines/look-class';
import { LookIcon } from '@/routines/look';
import { runRoutineNow, setRoutinePaused } from '@/routines/routine-commands';
import { useRoutineList } from '@/routines/routine-list';
import { useRoutineWhat } from '@/routines/routine-what';
import { showRoutine } from '@/routines/stage';
import { rowStatus, runWords, scheduleWords, weekdayClock } from '@/routines/words';
import { useFileToolbarSlot } from '@/shell/panels/file-toolbar-slot';
import { useCanvas } from '@/state/canvas';
import { useEndpointId } from '@/state/keys';
import { useProject } from '@/state/project';
import { useMachineAnswers } from '@/transport/features';

// The newest runs the strip shows; the stage has the rest.
const STRIP_RUNS = 10;

/*
 * A routine of the window's project on a canvas, read from the machine's routine list the stage reads
 * too. The node holds only the routine's id, which travels in the shared file: a teammate whose machine
 * does not keep that routine sees it say so.
 */
export function RoutineNodeBody({ id }: { id: string }) {
    const { t } = useTranslation('routines');
    const routineId = useCanvas((s) => s.nodes[id]?.routine);
    const projectId = useProject((s) => s.current?.projectId ?? null);
    const endpointId = useEndpointId();
    const list = useRoutineList(endpointId);
    if (list === null) {
        return <Plate icon={CircleAlert}>{t('node.noRoutines')}</Plate>;
    }
    if (list.status === 'loading') {
        return <Plate busy>{t('stage.loading')}</Plate>;
    }
    if (list.status === 'failed') {
        return <Plate icon={WifiOff}>{t('stage.failed')}</Plate>;
    }
    const entry = list.result.routines.find((candidate) => candidate.projectId === projectId && candidate.routine.id === routineId);
    if (entry === undefined) {
        return (
            <Plate icon={CalendarClock}>
                <span className="text-text">{t('node.notHere')}</span>
                <span>{t('node.notHereDetail')}</span>
            </Plate>
        );
    }
    return <RoutineOnCanvas endpointId={endpointId} entry={entry} timeZone={list.result.timeZone} />;
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

function RoutineOnCanvas({ endpointId, entry, timeZone }: { endpointId: string; entry: RoutineEntry; timeZone: string }) {
    const { t } = useTranslation('routines');
    const what = useRoutineWhat(entry);
    const [picked, setPicked] = useState<string | null>(null);
    const target = { projectId: entry.projectId, routineId: entry.routine.id };
    const paused = entry.local.pausedAt !== undefined;
    const status = rowStatus(entry, timeZone);
    const run = entry.runs.find((candidate) => candidate.runId === picked) ?? entry.runs.find((candidate) => candidate.state !== 'skipped') ?? entry.runs[0];
    const strip = entry.runs.slice(0, STRIP_RUNS).reverse();
    const artifactId = entry.artifactId;
    // A block opens its run where its chat is drawn: in Routines, at that run.
    const openRun = (runId: string): void => {
        setPicked(runId);
        showRoutine(target, runId);
    };
    return (
        <div className="flex h-full min-h-0 w-full flex-col gap-3 overflow-y-auto p-3">
            <HeaderControls>
                {paused ? (
                    <Pill icon={<Icon icon={CirclePause} size={12} />}>{t('row.paused')}</Pill>
                ) : (
                    entry.next !== null && <Pill icon={<Icon icon={Clock} size={12} />}>{weekdayClock(entry.next, timeZone)}</Pill>
                )}
                <Switch
                    checked={!paused}
                    label={paused ? t('node.resume') : t('node.pause')}
                    disabled={!entry.approved}
                    onCheckedChange={(runs) => setRoutinePaused(endpointId, entry, !runs)}
                />
                <IconButton icon={Clock} size="sm" label={t('node.openInRoutines')} onClick={() => showRoutine(target)} />
            </HeaderControls>
            <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-text-muted">
                <span>{scheduleWords(entry.routine.schedule)}</span>
                <span className="text-text-faint">·</span>
                <span className={entry.routine.kind === 'agent' ? undefined : 'font-mono'}>{what}</span>
            </p>
            {status.tone === 'needs' && <p className="text-xs text-status-needs-you">{status.text}</p>}
            <div className="flex items-center gap-1.5">
                <Button size="xs" variant="secondary" disabled={!entry.approved} onClick={() => void runRoutineNow(endpointId, entry)}>
                    <Icon icon={Play} size={12} />
                    {t('actions.runNow')}
                </Button>
                <Button size="xs" variant="ghost" disabled={!entry.approved} onClick={() => setRoutinePaused(endpointId, entry, !paused)}>
                    <Icon icon={paused ? Play : Pause} size={12} />
                    {paused ? t('actions.resume') : t('actions.pause')}
                </Button>
            </div>
            <section className="flex flex-col gap-1.5" aria-label={t('detail.runs')}>
                <SectionLabel render={<h3 />}>{t('detail.runs')}</SectionLabel>
                {strip.length === 0 && entry.next === null ? (
                    <p className="text-xs text-text-muted">{t('detail.noRunsYet')}</p>
                ) : (
                    <div className="flex flex-wrap gap-1">
                        {strip.map((candidate) => (
                            <RunBlock key={candidate.runId} run={candidate} picked={candidate.runId === run?.runId} timeZone={timeZone} onOpen={openRun} />
                        ))}
                        {entry.next !== null && (
                            <span
                                data-look={paused ? 'paused' : 'next'}
                                role="img"
                                aria-label={t('node.nextBlock', { time: weekdayClock(entry.next, timeZone) })}
                                className={`grid h-6 w-7 place-items-center ${blockClass(paused ? 'paused' : 'next')}`}
                            />
                        )}
                    </div>
                )}
                {run !== undefined && <p className="text-xs text-text-muted">{runSentence(run, timeZone)}</p>}
            </section>
            {artifactId !== undefined && (
                <section className="flex min-h-48 grow flex-col gap-1.5" aria-label={t('node.latest')}>
                    <SectionLabel render={<h3 />}>{t('node.latest')}</SectionLabel>
                    <LatestVersion endpointId={endpointId} artifactId={artifactId} />
                </section>
            )}
        </div>
    );
}

function runSentence(run: RoutineRun, timeZone: string): string {
    return `${formatDateTime(run.due, { weekday: 'short', day: 'numeric', month: 'short', timeZone })}: ${runWords(run, timeZone)}`;
}

function RunBlock({ run, picked, timeZone, onOpen }: { run: RoutineRun; picked: boolean; timeZone: string; onOpen: (runId: string) => void }) {
    const { t } = useTranslation('routines');
    const look = lookOfRun(run);
    return (
        <button
            type="button"
            data-look={look}
            aria-pressed={picked}
            aria-label={`${formatDateTime(run.due, { weekday: 'short', day: 'numeric', month: 'short', timeZone })}, ${t(`looks.${look}`)}`}
            className={`grid h-6 w-7 place-items-center ${blockClass(look)} ${picked ? 'outline-2 outline-offset-1 outline-text-muted' : ''}`}
            onClick={() => onOpen(run.runId)}
        >
            <LookIcon look={look} />
        </button>
    );
}

/* The newest version of the routine's Output artifact, drawn as the artifact node draws one. */
function LatestVersion({ endpointId, artifactId }: { endpointId: string; artifactId: string }) {
    const { t } = useTranslation('output');
    const { t: words } = useTranslation('routines');
    const answers = useMachineAnswers(endpointId, 'artifact.get');
    const state = useArtifact(endpointId, artifactId, answers);
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
        return <Plate icon={Package}>{t('node.removed')}</Plate>;
    }
    const { artifact, versions } = state.result;
    const latest = versions[0]!;
    return (
        <div className="flex min-h-0 grow flex-col overflow-hidden rounded-lg border border-border bg-clip-padding">
            <header className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3 text-xs">
                <Icon icon={Package} size={12} className="text-text-muted" />
                <span className="truncate text-text">{artifact.title}</span>
                <Pill className="tabular-nums">{`v${latest.number}`}</Pill>
            </header>
            <ErrorBoundary label={t('view.failed')} resetKeys={[latest.versionId]} className="flex min-h-0 grow flex-col">
                <VersionBody endpointId={endpointId} artifact={artifact} version={latest} />
            </ErrorBoundary>
            <footer className="flex h-8 shrink-0 items-center border-t border-border px-1">
                <Button size="xs" variant="ghost" onClick={() => openArtifact(artifact.artifactId, artifact.title)}>
                    <Icon icon={SquareArrowOutUpRight} size={12} />
                    {words('detail.openInOutput')}
                </Button>
            </footer>
        </div>
    );
}

/* The next time, the pause switch and the way into Routines ride in the node's header, as a file node's controls do. */
function HeaderControls({ children }: { children: ReactNode }) {
    const { host } = useFileToolbarSlot();
    return host === null ? null : createPortal(children, host);
}
