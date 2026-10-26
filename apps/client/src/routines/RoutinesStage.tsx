import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ChevronLeft, ChevronRight, CircleAlert, Clock, LayoutGrid, MoreHorizontal, Pause, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { isCanvasView, type RoutineEntry, type RoutineListResult } from '@ruimte/contracts';
import { Button, ButtonGroup, EmptyState, Icon, IconButton, Menu, PromptDialog, Select, Separator, useNow } from '@adecore/ui';
import { formatDay, formatDayWithYear } from '@adecore/ui/format';
import { weekOf } from '@/routines/agenda';
import { openRoutineForm } from '@/routines/form-state';
import { RoutineAgenda, type AgendaGroup } from '@/routines/RoutineAgenda';
import { RoutineDetail } from '@/routines/RoutineDetail';
import { runRoutineNow, setRoutinePaused, showRoutineOnCanvas } from '@/routines/routine-commands';
import { refreshRoutines, useRoutineList } from '@/routines/routine-list';
import { RoutineSide } from '@/routines/RoutineSide';
import { leaveRoutines, setRoutinesFilter, showRoutine, stepWeek, useRoutinesStage } from '@/routines/stage';
import { activeViewOf, useDocument } from '@/state/document';
import { useEndpointId } from '@/state/keys';
import { useProject } from '@/state/project';
import { machineTransport } from '@/transport';

const MINUTE_MS = 60_000;

/* Routines over the whole view stage: the week of the project's routines, or one routine opened inside it. */
export function RoutinesStage() {
    const { t } = useTranslation('routines');
    const endpointId = useEndpointId();
    const list = useRoutineList(endpointId);
    const projectId = useProject((s) => s.current?.projectId ?? null);
    const projectName = useProject((s) => s.current?.name ?? '');
    const stage = useRoutinesStage();

    if (list === null || projectId === null) {
        return null;
    }
    if (list.status !== 'ready') {
        return (
            <StageFrame>
                <StageHeader title={t('stage.title')} />
                <div className="grid grow place-items-center">
                    {list.status === 'loading' ? (
                        <EmptyState busy>{t('stage.loading')}</EmptyState>
                    ) : (
                        <EmptyState icon={CircleAlert}>{t('stage.failed')}</EmptyState>
                    )}
                </div>
            </StageFrame>
        );
    }
    const { result } = list;
    if (stage.routine !== null) {
        const entry = result.routines.find((candidate) => candidate.projectId === stage.routine?.projectId && candidate.routine.id === stage.routine.routineId);
        if (entry !== undefined) {
            return (
                <StageFrame>
                    <DetailHeader endpointId={endpointId} entry={entry} rev={result.revs[entry.projectId] ?? 0} />
                    <RoutineDetail
                        endpointId={endpointId}
                        entry={entry}
                        runId={stage.runId}
                        rev={result.revs[entry.projectId] ?? 0}
                        timeZone={result.timeZone}
                    />
                </StageFrame>
            );
        }
    }
    return <WeekStage endpointId={endpointId} result={result} projectId={projectId} projectName={projectName} />;
}

function StageFrame({ children }: { children: React.ReactNode }) {
    const { t } = useTranslation('routines');
    return (
        <section className="absolute inset-0 z-10 flex flex-col bg-surface" aria-label={t('stage.title')}>
            {children}
        </section>
    );
}

/* Back to the view, then where in Routines this is. */
function StageHeader({ title, crumbs, children }: { title: string; crumbs?: React.ReactNode; children?: React.ReactNode }) {
    const { t } = useTranslation('routines');
    const viewName = useDocument((s) => {
        const view = activeViewOf(s);
        return view === null || view === undefined ? null : (view.name ?? null);
    });
    return (
        <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-2 text-sm">
            <Button size="sm" onClick={leaveRoutines} aria-label={t('stage.back', { view: viewName ?? t('stage.backView') })}>
                <Icon icon={ArrowLeft} size={14} />
                {viewName ?? t('stage.backView')}
            </Button>
            <Separator />
            <Icon icon={Clock} size={14} className="text-text-muted" />
            {crumbs ?? <h2 className="font-medium text-text">{title}</h2>}
            {children}
        </header>
    );
}

function WeekStage({ endpointId, result, projectId, projectName }: { endpointId: string; result: RoutineListResult; projectId: string; projectName: string }) {
    const { t } = useTranslation('routines');
    const offset = useRoutinesStage((s) => s.week);
    const filter = useRoutinesStage((s) => s.filter);
    const now = useNow(MINUTE_MS);
    const week = weekOf(now, result.timeZone, offset);
    const grouped = filter === 'all';
    const shown = grouped ? result.routines : result.routines.filter((entry) => entry.projectId === projectId);
    const groups = groupsOf(shown, projectId, projectName);
    const last = week.days[6]!;

    return (
        <StageFrame>
            <StageHeader title={t('stage.title')}>
                <ButtonGroup>
                    <IconButton icon={ChevronLeft} size="sm" label={t('stage.previousWeek')} onClick={() => stepWeek(-1)} />
                    <IconButton icon={ChevronRight} size="sm" label={t('stage.nextWeek')} onClick={() => stepWeek(1)} />
                </ButtonGroup>
                <Button size="sm" variant="secondary" disabled={offset === 0} onClick={() => stepWeek(0)}>
                    {t('stage.today')}
                </Button>
                <span className="truncate text-text">
                    {t('stage.range', {
                        from: formatDay(week.days[0]!.start + 12 * 3_600_000, result.timeZone),
                        to: formatDayWithYear(last.start + 12 * 3_600_000, result.timeZone)
                    })}
                </span>
                <span className="shrink-0 text-xs text-text-faint">{t('stage.week', { number: week.number })}</span>
                <span className="grow" />
                <Select
                    size="sm"
                    label={t('filter.label')}
                    value={filter}
                    onValueChange={setRoutinesFilter}
                    items={[
                        { value: 'project', label: projectName },
                        { value: 'all', label: t('filter.all') }
                    ]}
                />
                <Button size="sm" variant="secondary" onClick={() => openRoutineForm({ projectId, pickProject: grouped })}>
                    <Icon icon={Plus} size={14} />
                    {t('actions.new')}
                </Button>
            </StageHeader>
            <div className="flex min-h-0 grow">
                {shown.length === 0 && !grouped ? (
                    <div className="flex min-w-0 grow flex-col">
                        <RoutineAgenda
                            endpointId={endpointId}
                            projectId={projectId}
                            groups={[]}
                            grouped={false}
                            week={week}
                            now={now}
                            timeZone={result.timeZone}
                        />
                        <div className="grid grow place-items-center p-6">
                            <EmptyState icon={Clock} title={t('stage.emptyTitle')}>
                                {t('stage.empty')}
                            </EmptyState>
                        </div>
                    </div>
                ) : (
                    <RoutineAgenda
                        endpointId={endpointId}
                        projectId={projectId}
                        groups={groups}
                        grouped={grouped}
                        week={week}
                        now={now}
                        timeZone={result.timeZone}
                    />
                )}
                <RoutineSide endpointId={endpointId} entries={shown} grouped={grouped} timeZone={result.timeZone} />
            </div>
        </StageFrame>
    );
}

/* The open project first, then the others by name, each with its routines in the order the machine keeps them. */
function groupsOf(entries: readonly RoutineEntry[], projectId: string, projectName: string): AgendaGroup[] {
    const groups = new Map<string, AgendaGroup>();
    groups.set(projectId, { projectId, projectName, entries: [] });
    for (const entry of entries) {
        const group = groups.get(entry.projectId) ?? { projectId: entry.projectId, projectName: entry.projectName, entries: [] };
        group.entries.push(entry);
        groups.set(entry.projectId, group);
    }
    const [own, ...others] = [...groups.values()];
    return [own!, ...others.sort((left, right) => left.projectName.localeCompare(right.projectName))].filter((group) => group.entries.length > 0);
}

function DetailHeader({ endpointId, entry, rev }: { endpointId: string; entry: RoutineEntry; rev: number }) {
    const { t } = useTranslation('routines');
    const [removing, setRemoving] = useState(false);
    const paused = entry.local.pausedAt !== undefined;
    const target = { projectId: entry.projectId, routineId: entry.routine.id };
    const projectId = useProject((s) => s.current?.projectId ?? null);
    const hasCanvas = useDocument((s) => s.views.some((view) => isCanvasView(view) && view.hidden !== true));
    const runNow = async (): Promise<void> => {
        const runId = await runRoutineNow(endpointId, entry);
        if (runId !== null) {
            showRoutine(target, runId);
        }
    };
    const remove = async (): Promise<void> => {
        await machineTransport(endpointId).request('routine.remove', { ...target, baseRev: rev });
        showRoutine(null);
        refreshRoutines(endpointId);
    };
    return (
        <StageHeader
            title={entry.routine.title}
            crumbs={
                <nav className="flex min-w-0 items-center gap-1.5" aria-label={t('stage.breadcrumb')}>
                    <button type="button" className="shrink-0 text-text-muted hover:text-text" onClick={() => showRoutine(null)}>
                        {t('stage.title')}
                    </button>
                    <span className="text-text-faint">/</span>
                    <h2 className="truncate font-medium text-text">{entry.routine.title}</h2>
                </nav>
            }
        >
            <span className="grow" />
            <Button size="sm" variant="secondary" disabled={!entry.approved} onClick={() => void runNow()}>
                <Icon icon={Play} size={14} />
                {t('actions.runNow')}
            </Button>
            <Button size="sm" disabled={!entry.approved} onClick={() => setRoutinePaused(endpointId, entry, !paused)}>
                <Icon icon={paused ? Play : Pause} size={14} />
                {paused ? t('actions.resume') : t('actions.pause')}
            </Button>
            {hasCanvas && entry.projectId === projectId && (
                <Button size="sm" onClick={() => void showRoutineOnCanvas(entry)}>
                    <Icon icon={LayoutGrid} size={14} />
                    {t('detail.showOnCanvas')}
                </Button>
            )}
            <Menu.Root>
                <IconButton icon={MoreHorizontal} size="sm" label={t('actions.more')} render={<Menu.Trigger />} />
                <Menu.Popup align="end">
                    <Menu.Item onClick={() => openRoutineForm({ projectId: entry.projectId, editing: entry })}>
                        <Icon icon={Pencil} size={14} /> {t('actions.edit')}
                    </Menu.Item>
                    <Menu.Item className="text-status-error" onClick={() => setRemoving(true)}>
                        <Icon icon={Trash2} size={14} /> {t('actions.remove')}
                    </Menu.Item>
                </Menu.Popup>
            </Menu.Root>
            <PromptDialog
                open={removing}
                title={t('remove.title', { title: entry.routine.title })}
                description={t('remove.description')}
                confirmLabel={t('remove.confirm')}
                confirmIcon={Trash2}
                danger
                fallbackMessage={t('remove.failed')}
                onConfirm={remove}
                onOpenChange={() => setRemoving(false)}
            />
        </StageHeader>
    );
}
