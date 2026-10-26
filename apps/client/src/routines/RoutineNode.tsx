import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { CalendarClock, CircleAlert, CirclePause, Clock, Folder, Hand, Package, Play, Rocket, WifiOff } from 'lucide-react';
import type { RoutineEntry, RoutineRun } from '@ruimte/contracts';
import { ButtonGroup, EmptyState, Icon, IconButton, Pill, Separator, Switch, Tooltip, useNow } from '@adecore/ui';
import { formatCountdown, formatDateTime } from '@adecore/ui/format';
import { runtimeModeLabel } from '@adecore/agents-react/chat';
import { lookOfRun, type BlockLook } from '@/routines/agenda';
import { blockClass } from '@/routines/look-class';
import { RoutineAgent } from '@/routines/RoutineAgent';
import { runRoutineNow, setRoutinePaused } from '@/routines/routine-commands';
import { useRoutineList } from '@/routines/routine-list';
import { useRoutineWhat } from '@/routines/routine-what';
import { showRoutine } from '@/routines/stage';
import { rowStatus, runWords, scheduleWords, weekdayClock } from '@/routines/words';
import { useFileToolbarSlot } from '@/shell/panels/file-toolbar-slot';
import { useCanvas } from '@/state/canvas';
import { useEndpointId } from '@/state/keys';
import { useProject } from '@/state/project';

// The newest runs the strip shows; the stage has the rest.
const STRIP_RUNS = 14;
const MINUTE_MS = 60_000;

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
    const [picked, setPicked] = useState<string | null>(null);
    const target = { projectId: entry.projectId, routineId: entry.routine.id };
    const paused = entry.local.pausedAt !== undefined;
    const routine = entry.routine;
    const run = entry.runs.find((candidate) => candidate.runId === picked) ?? entry.runs.find((candidate) => candidate.state !== 'skipped') ?? entry.runs[0];
    const strip = entry.runs.slice(0, STRIP_RUNS).reverse();
    // A block opens its run where its chat is drawn: in Routines, at that run.
    const openRun = (runId: string): void => {
        setPicked(runId);
        showRoutine(target, runId);
    };
    return (
        // The node scrolls as a whole, so no part of it is squeezed to fit its height.
        <div className={clsx('flex h-full min-h-0 w-full flex-col gap-3 overflow-y-auto p-3 *:shrink-0', paused && 'opacity-70')}>
            <HeaderControls>
                <Switch
                    checked={!paused && entry.local.declined !== entry.digest}
                    label={paused ? t('node.resume') : t('node.pause')}
                    disabled={!entry.approved}
                    onCheckedChange={(runs) => setRoutinePaused(endpointId, entry, !runs)}
                />
                <ButtonGroup render={<span />}>
                    <IconButton
                        icon={Play}
                        size="sm"
                        label={t('actions.runNow')}
                        disabled={!entry.approved}
                        onClick={() => void runRoutineNow(endpointId, entry)}
                    />
                    <IconButton icon={Clock} size="sm" label={t('node.openInRoutines')} onClick={() => showRoutine(target)} />
                </ButtonGroup>
                <Separator />
            </HeaderControls>
            <p className="text-lg font-semibold text-text">{scheduleWords(routine.schedule)}</p>
            {routine.kind === 'agent' && (
                <p className="line-clamp-4 rounded-lg border border-border bg-surface-sunken bg-clip-padding px-3 py-2 text-sm whitespace-pre-wrap text-text">
                    {routine.prompt}
                </p>
            )}
            {routine.kind === 'command' && (
                <p className="line-clamp-4 rounded-lg border border-border bg-surface-sunken bg-clip-padding px-3 py-2 font-mono text-code whitespace-pre-wrap text-text">
                    {routine.command}
                </p>
            )}
            <RoutineChips endpointId={endpointId} entry={entry} />
            <NextCard entry={entry} timeZone={timeZone} />
            <section className="flex flex-col gap-1.5" aria-label={t('detail.runs')}>
                {strip.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                        {strip.map((candidate) => (
                            <RunBlock key={candidate.runId} run={candidate} picked={candidate.runId === run?.runId} timeZone={timeZone} onOpen={openRun} />
                        ))}
                        {entry.next !== null && (
                            <span
                                data-look={paused ? 'paused' : 'next'}
                                role="img"
                                aria-label={t('node.nextBlock', { time: weekdayClock(entry.next, timeZone) })}
                                className={clsx('size-5', blockClass(paused ? 'paused' : 'next'))}
                            />
                        )}
                    </div>
                )}
                {strip.length > 0 && <StripCounts runs={strip} />}
                {run !== undefined && <p className="text-xs text-text-muted">{runSentence(run, timeZone)}</p>}
            </section>
        </div>
    );
}

function runSentence(run: RoutineRun, timeZone: string): string {
    return `${formatDateTime(run.due, { weekday: 'short', day: 'numeric', month: 'short', timeZone })}: ${runWords(run, timeZone)}`;
}

function RunBlock({ run, picked, timeZone, onOpen }: { run: RoutineRun; picked: boolean; timeZone: string; onOpen: (runId: string) => void }) {
    const { t } = useTranslation('routines');
    const look = lookOfRun(run);
    const label = `${formatDateTime(run.due, { weekday: 'short', day: 'numeric', month: 'short', timeZone })}, ${t(`looks.${look}`)}`;
    return (
        <Tooltip label={label}>
            <button
                type="button"
                data-look={look}
                aria-pressed={picked}
                aria-label={label}
                className={clsx('size-5', blockClass(look))}
                onClick={() => onOpen(run.runId)}
            />
        </Tooltip>
    );
}

/* What the routine starts, as the chips under its instructions: the agent and model and its mode, a folder, or a launch. */
function RoutineChips({ endpointId, entry }: { endpointId: string; entry: RoutineEntry }) {
    const what = useRoutineWhat(entry);
    const routine = entry.routine;
    return (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {routine.kind === 'agent' && (
                <>
                    <Pill>
                        <RoutineAgent endpointId={endpointId} provider={routine.provider} model={routine.selection?.model} size={12} />
                    </Pill>
                    <Pill>{runtimeModeLabel(routine.mode)}</Pill>
                </>
            )}
            {routine.kind === 'command' && <Pill icon={<Icon icon={Folder} size={12} />}>{routine.cwd ?? '.'}</Pill>}
            {routine.kind === 'launch' && <Pill icon={<Icon icon={Rocket} size={12} />}>{what}</Pill>}
        </div>
    );
}

/* When it runs next and how long that is from now; what stops it instead when it is paused, held or denied. */
function NextCard({ entry, timeZone }: { entry: RoutineEntry; timeZone: string }) {
    const { t } = useTranslation('routines');
    const now = useNow(MINUTE_MS);
    const status = rowStatus(entry, timeZone);
    const pausedAt = entry.local.pausedAt;
    const card = 'flex items-center gap-2.5 rounded-lg border border-border bg-surface-raised bg-clip-padding px-3 py-2';
    if (status.tone === 'needs') {
        return (
            <div className={clsx(card, 'text-status-needs-you')}>
                <Icon icon={Hand} size={16} className="shrink-0" />
                <span className="text-sm">{status.text}</span>
            </div>
        );
    }
    if (pausedAt !== undefined) {
        return (
            <div className={clsx(card, 'text-text-muted')}>
                <Icon icon={CirclePause} size={16} className="shrink-0" />
                <span className="text-sm">{t('band.since', { since: formatDateTime(pausedAt, { day: 'numeric', month: 'short', timeZone }) })}</span>
            </div>
        );
    }
    if (entry.next === null) {
        return (
            <div className={clsx(card, 'text-text-muted')}>
                <Icon icon={CalendarClock} size={16} className="shrink-0" />
                <span className="text-sm">{status.text}</span>
            </div>
        );
    }
    return (
        <div className={card}>
            <Icon icon={Clock} size={16} className="shrink-0 text-accent" />
            <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm text-text">{t('node.nextRun', { time: weekdayClock(entry.next, timeZone) })}</span>
                <span className="text-xs text-text-muted">{t('node.inTime', { time: formatCountdown(entry.next - now) })}</span>
            </span>
        </div>
    );
}

/* How the runs in the strip went, counted: the line under the blocks. */
function StripCounts({ runs }: { runs: readonly RoutineRun[] }) {
    const { t } = useTranslation('routines');
    const looks = runs.map(lookOfRun);
    const count = (...wanted: BlockLook[]): number => looks.filter((look) => wanted.includes(look)).length;
    const parts = [
        count('done', 'waited', 'caught-up') > 0 ? t('node.countDone', { count: count('done', 'waited', 'caught-up') }) : null,
        count('waited') > 0 ? t('node.countWaited', { count: count('waited') }) : null,
        count('failed', 'limit') > 0 ? t('node.countFailed', { count: count('failed', 'limit') }) : null
    ].filter((part) => part !== null);
    return (
        <p className="flex items-center justify-between gap-2 text-xs text-text-faint">
            <span>{t('node.lastRuns', { count: runs.length })}</span>
            <span className="truncate">{parts.join(' · ')}</span>
        </p>
    );
}

/* The next time, the pause switch and the way into Routines ride in the node's header, as a file node's controls do. */
function HeaderControls({ children }: { children: ReactNode }) {
    const { host } = useFileToolbarSlot();
    return host === null ? null : createPortal(children, host);
}
