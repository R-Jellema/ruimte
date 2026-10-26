import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleCheck } from 'lucide-react';
import type { RoutineEntry } from '@ruimte/contracts';
import { Button, FormError, Icon, SectionLabel, messageOf } from '@adecore/ui';
import { OutputProjectGlyph } from '@/output/look';
import { awaitingApproval, LEGEND, runsWaiting } from '@/routines/agenda';
import { LookSwatch } from '@/routines/look';
import { refreshRoutines } from '@/routines/routine-list';
import { showRoutine } from '@/routines/stage';
import { scheduleWords, weekdayClock } from '@/routines/words';
import { useRoutineWhat } from '@/routines/routine-what';
import { endpointKey } from '@/state/keys';
import { machineTransport } from '@/transport';
import { useChats } from '@adecore/agents-react/state';

/* The right column of the week: what waits for approval here, the runs waiting on a person, and what the blocks mean. */
export function RoutineSide({ endpointId, entries, grouped, timeZone }: { endpointId: string; entries: RoutineEntry[]; grouped: boolean; timeZone: string }) {
    const { t } = useTranslation('routines');
    const held = awaitingApproval(entries);
    const waiting = runsWaiting(entries);
    return (
        <aside className="flex w-[288px] shrink-0 flex-col overflow-y-auto border-l border-border" aria-label={t('side.label')}>
            {held.length > 0 && (
                <section className="flex flex-col gap-2 border-b border-border p-3" aria-label={t('side.approvals')}>
                    <SectionLabel render={<h3 />} className="flex items-center gap-2">
                        <span aria-hidden="true" className="size-1.5 rounded-full bg-status-needs-you" />
                        {t('side.approvals')}
                        <span className="ml-auto tabular-nums">{held.length}</span>
                    </SectionLabel>
                    {held.map((entry) => (
                        <ApprovalCard key={`${entry.projectId}:${entry.routine.id}`} endpointId={endpointId} entry={entry} grouped={grouped} />
                    ))}
                </section>
            )}
            <section className="flex flex-col gap-2 border-b border-border p-3" aria-label={t('side.needsYou')}>
                <SectionLabel render={<h3 />} className="flex items-center gap-2">
                    {waiting.length > 0 && <span aria-hidden="true" className="size-1.5 rounded-full bg-status-needs-you" />}
                    {t('side.needsYou')}
                    <span className="ml-auto tabular-nums">{waiting.length}</span>
                </SectionLabel>
                {waiting.length === 0 ? (
                    <p className="text-xs text-text-muted">{t('side.nothingWaits')}</p>
                ) : (
                    waiting.map(({ entry, run }) => (
                        <button
                            key={run.runId}
                            type="button"
                            className="flex items-start gap-2 rounded-md px-1 py-1 text-left hover:bg-surface-hover"
                            onClick={() => showRoutine({ projectId: entry.projectId, routineId: entry.routine.id }, run.runId)}
                        >
                            {grouped && <OutputProjectGlyph endpointId={endpointId} projectId={entry.projectId} />}
                            <span className="flex min-w-0 flex-col">
                                <span className="truncate text-sm text-text">{entry.routine.title}</span>
                                <WaitingFor endpointId={endpointId} chatId={run.chatId} since={weekdayClock(run.at, timeZone)} />
                            </span>
                        </button>
                    ))
                )}
            </section>
            <section className="mt-auto grid grid-cols-2 gap-x-3 gap-y-1.5 p-3" aria-label={t('side.legend')}>
                {LEGEND.map((look) => (
                    <span key={look} className="flex items-center gap-2 text-xs text-text-muted">
                        <LookSwatch look={look} />
                        {t(`looks.${look}`)}
                    </span>
                ))}
            </section>
        </aside>
    );
}

/*
 * What a waiting run asks, from the status of its chat that every client hears, since the routine's own
 * wire carries no question. Until that status is here it says since when the run waits.
 */
function WaitingFor({ endpointId, chatId, since }: { endpointId: string; chatId: string | undefined; since: string }) {
    const { t } = useTranslation('routines');
    const request = useChats((s) => (chatId === undefined ? undefined : s.statusByKey[endpointKey(endpointId, chatId)]?.info.requests?.[0]));
    const asked = request?.question?.questions[0]?.question ?? request?.approval?.subject;
    return <span className="line-clamp-2 text-xs break-words text-text-muted">{asked || t('side.waitsSince', { time: since })}</span>;
}

function ApprovalCard({ endpointId, entry, grouped }: { endpointId: string; entry: RoutineEntry; grouped: boolean }) {
    const { t } = useTranslation('routines');
    const what = useRoutineWhat(entry);
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);
    const origin = entry.held === 'agent' ? t('approval.byAgent', { title: entry.madeBy?.title ?? t('approval.anAgent') }) : t('approval.fromOutside');
    const answer = (type: 'routine.approve' | 'routine.decline'): void => {
        setBusy(true);
        setFailure(null);
        machineTransport(endpointId)
            .request(type, { projectId: entry.projectId, routineId: entry.routine.id, digest: entry.digest })
            .then(() => refreshRoutines(endpointId))
            .catch((e: unknown) => setFailure(messageOf(e, t('approval.failed'))))
            .finally(() => setBusy(false));
    };
    return (
        <article className="flex flex-col gap-1 rounded-lg border border-border bg-surface-raised bg-clip-padding p-3" aria-label={entry.routine.title}>
            <span className="flex min-w-0 items-center gap-2">
                {grouped && <OutputProjectGlyph endpointId={endpointId} projectId={entry.projectId} />}
                <span className="truncate text-sm font-medium text-text">{entry.routine.title}</span>
            </span>
            <span className="text-xs text-text-faint">{scheduleWords(entry.routine.schedule)}</span>
            <span className="text-xs text-text-muted">{origin}</span>
            <span className={`truncate text-xs text-text-muted ${entry.routine.kind === 'command' ? 'font-mono' : ''}`}>{what}</span>
            {failure !== null && <FormError className="break-words">{failure}</FormError>}
            <span className="mt-1 flex items-center justify-end gap-1.5">
                <Button size="sm" disabled={busy} onClick={() => answer('routine.decline')}>
                    {t('approval.deny')}
                </Button>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => answer('routine.approve')}>
                    <Icon icon={CircleCheck} size={14} />
                    {t('approval.approve')}
                </Button>
            </span>
        </article>
    );
}
