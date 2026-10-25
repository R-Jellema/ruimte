import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import type { RoutineEntry } from '@ruimte/contracts';
import { Icon, Popover, Switch } from '@adecore/ui';
import { formatClock, formatDateTime } from '@adecore/ui/format';
import { OutputProjectGlyph } from '@/output/look';
import { blocksOf, scheduleForDays, type AgendaBlock, type AgendaWeek } from '@/routines/agenda';
import { LookIcon } from '@/routines/look';
import { blockClass } from '@/routines/look-class';
import { refreshRoutines } from '@/routines/routine-list';
import { RoutineForm } from '@/routines/RoutineForm';
import { showRoutine } from '@/routines/stage';
import { rowStatus } from '@/routines/words';
import { machineTransport } from '@/transport';

const NAME_COLUMN = 208;
const GRID = 'grid grid-cols-[208px_repeat(7,minmax(0,1fr))]';

export interface AgendaGroup {
    projectId: string;
    projectName: string;
    entries: RoutineEntry[];
}

interface DragDays {
    from: number;
    to: number;
    done: boolean;
}

/*
 * The week: a row per routine with a block per run on the day it was due, the times still to come
 * dotted, and a line at now. Dragging across the days of the bottom row makes a routine on those days.
 */
export function RoutineAgenda({
    endpointId,
    projectId,
    groups,
    grouped,
    week,
    now,
    timeZone
}: {
    endpointId: string;
    projectId: string;
    groups: AgendaGroup[];
    grouped: boolean;
    week: AgendaWeek;
    now: number;
    timeZone: string;
}) {
    const { t } = useTranslation('routines');
    const today = week.days.findIndex((day) => now >= day.start && now < day.end);
    const nowAt = today < 0 ? null : (today + (now - week.days[today]!.start) / (week.days[today]!.end - week.days[today]!.start)) / 7;
    const title = grouped ? t('agenda.allTitle') : t('agenda.projectTitle', { name: groups[0]?.projectName ?? '' });

    return (
        <div className="relative min-h-0 min-w-0 grow overflow-auto" role="grid" aria-label={t('agenda.label')}>
            <div className={`${GRID} sticky top-0 z-[1] h-9 items-center border-b border-border bg-surface text-xs text-text-muted`} role="row">
                <span className="truncate px-3" role="columnheader">
                    {title}
                </span>
                {week.days.map((day, index) => (
                    <span key={day.date} role="columnheader" className="flex items-center gap-1 px-2">
                        {formatDateTime(day.start + 12 * 60 * 60 * 1000, { weekday: 'short', timeZone })}
                        <span className={index === today ? 'rounded-sm bg-text px-1 font-medium text-bg' : 'font-medium text-text'}>
                            {formatDateTime(day.start + 12 * 60 * 60 * 1000, { day: 'numeric', timeZone })}
                        </span>
                    </span>
                ))}
            </div>
            {groups.map((group) => (
                <div key={group.projectId} role="rowgroup" aria-label={group.projectName}>
                    {grouped && (
                        <div className={`${GRID} h-8 items-center border-b border-border-soft text-xs text-text-muted`} role="row">
                            <span className="flex min-w-0 items-center gap-2 px-3">
                                <OutputProjectGlyph endpointId={endpointId} projectId={group.projectId} />
                                <span className="truncate">{group.projectName}</span>
                            </span>
                        </div>
                    )}
                    {group.entries.map((entry) => (
                        <AgendaRow key={entry.routine.id} endpointId={endpointId} entry={entry} week={week} now={now} timeZone={timeZone} today={today} />
                    ))}
                </div>
            ))}
            <DragRow endpointId={endpointId} projectId={projectId} grouped={grouped} week={week} />
            {nowAt !== null && (
                <div
                    aria-hidden="true"
                    className="pointer-events-none absolute top-0 bottom-0 w-px bg-text"
                    style={{ left: `calc(${NAME_COLUMN}px + (100% - ${NAME_COLUMN}px) * ${nowAt})` }}
                >
                    <span className="absolute top-9 left-1/2 -translate-x-1/2 rounded-sm bg-text px-1 text-2xs font-medium text-bg">
                        {formatClock(now, timeZone)}
                    </span>
                </div>
            )}
        </div>
    );
}

function AgendaRow({
    endpointId,
    entry,
    week,
    now,
    timeZone,
    today
}: {
    endpointId: string;
    entry: RoutineEntry;
    week: AgendaWeek;
    now: number;
    timeZone: string;
    today: number;
}) {
    const { t } = useTranslation('routines');
    const blocks = blocksOf(entry, week, now, timeZone);
    const status = rowStatus(entry, timeZone);
    const paused = entry.local.pausedAt !== undefined;
    const target = { projectId: entry.projectId, routineId: entry.routine.id };
    const setPaused = (next: boolean): void => {
        void machineTransport(endpointId)
            .request(next ? 'routine.pause' : 'routine.resume', target)
            .then(() => refreshRoutines(endpointId))
            .catch(() => undefined);
    };
    return (
        <div className={`${GRID} min-h-14 border-b border-border-soft`} role="row" data-routine={entry.routine.id}>
            <div className="flex min-w-0 items-center gap-2 px-3 py-2" role="rowheader">
                <button type="button" className="flex min-w-0 grow flex-col items-start text-left" onClick={() => showRoutine(target)}>
                    <span className="w-full truncate text-sm text-text hover:underline">{entry.routine.title}</span>
                    <span className={`w-full truncate text-xs ${status.tone === 'needs' ? 'text-status-needs-you' : 'text-text-muted'}`}>{status.text}</span>
                </button>
                <Switch
                    checked={!paused}
                    label={t(paused ? 'actions.resume' : 'actions.pause')}
                    disabled={!entry.approved}
                    onCheckedChange={(on) => setPaused(!on)}
                />
            </div>
            {week.days.map((day, index) => (
                <div key={day.date} role="gridcell" className={`flex flex-col gap-1 p-1 ${index === today ? 'bg-surface-hover/40' : ''}`}>
                    {blocks
                        .filter((block) => block.day === index)
                        .map((block) => (
                            <Block key={block.key} block={block} entry={entry} timeZone={timeZone} />
                        ))}
                </div>
            ))}
        </div>
    );
}

function Block({ block, entry, timeZone }: { block: AgendaBlock; entry: RoutineEntry; timeZone: string }) {
    const { t } = useTranslation('routines');
    const time = formatClock(block.at, timeZone);
    const label = t('agenda.block', { title: entry.routine.title, time, state: t(`looks.${block.look}`) });
    const body = (
        <>
            <span className="tabular-nums">{time}</span>
            <LookIcon look={block.look} />
        </>
    );
    const className = `flex h-7 w-full items-center justify-between gap-1 px-2 text-xs ${blockClass(block.look)}`;
    if (block.run === null) {
        return (
            <span className={className} aria-label={label} data-look={block.look}>
                {body}
            </span>
        );
    }
    const runId = block.run.runId;
    return (
        <button
            type="button"
            className={`${className} hover:brightness-110`}
            aria-label={label}
            data-look={block.look}
            onClick={() => showRoutine({ projectId: entry.projectId, routineId: entry.routine.id }, runId)}
        >
            {body}
        </button>
    );
}

/* The bottom row: a press on a day and a drag to another picks those days for a new routine. */
function DragRow({ endpointId, projectId, grouped, week }: { endpointId: string; projectId: string; grouped: boolean; week: AgendaWeek }) {
    const { t } = useTranslation('routines');
    const [drag, setDrag] = useState<DragDays | null>(null);
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const dragging = drag !== null && !drag.done;

    useEffect(() => {
        if (!dragging) {
            return;
        }
        const finish = (): void => setDrag((current) => (current === null ? null : { ...current, done: true }));
        window.addEventListener('pointerup', finish);
        return () => window.removeEventListener('pointerup', finish);
    }, [dragging]);

    const first = drag === null ? 0 : Math.min(drag.from, drag.to);
    const last = drag === null ? 0 : Math.max(drag.from, drag.to);
    const open = drag?.done === true;

    return (
        <div className={`${GRID} relative h-12 border-b border-border-soft select-none`} role="row">
            <span className="flex items-center gap-2 px-3 text-xs text-text-faint">
                <Icon icon={Plus} size={14} />
                {t('agenda.drag')}
            </span>
            {week.days.map((day, index) => (
                <div
                    key={day.date}
                    role="gridcell"
                    aria-label={t('agenda.dragDay', {
                        day: formatDateTime(day.start + 12 * 60 * 60 * 1000, { weekday: 'long', day: 'numeric', month: 'short' })
                    })}
                    data-drag-day={index}
                    className="cursor-cell hover:bg-surface-hover/50"
                    onPointerDown={(event) => {
                        if (event.button === 0) {
                            setDrag({ from: index, to: index, done: false });
                        }
                    }}
                    onPointerEnter={() => {
                        if (dragging) {
                            setDrag({ ...drag, to: index });
                        }
                    }}
                />
            ))}
            {drag !== null && (
                <div
                    ref={setAnchor}
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-y-1.5 rounded-md border border-dashed border-accent bg-accent-soft"
                    style={{
                        left: `calc(${NAME_COLUMN}px + (100% - ${NAME_COLUMN}px) * ${first / 7} + 4px)`,
                        width: `calc((100% - ${NAME_COLUMN}px) * ${(last - first + 1) / 7} - 8px)`
                    }}
                />
            )}
            <Popover.Root open={open && anchor !== null} onOpenChange={(next) => !next && setDrag(null)}>
                <Popover.Popup anchor={anchor} className="w-[400px] p-4" aria-label={t('form.newTitle')}>
                    {open && (
                        <RoutineForm
                            compact
                            endpointId={endpointId}
                            request={{ projectId, pickProject: grouped, schedule: scheduleForDays(week, first, last, '09:00') }}
                            onCancel={() => setDrag(null)}
                            onDone={() => setDrag(null)}
                        />
                    )}
                </Popover.Popup>
            </Popover.Root>
        </div>
    );
}
