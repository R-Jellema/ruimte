import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleCheck, GitCompare, Hand, Package, SquareArrowOutUpRight } from 'lucide-react';
import type { AgentKind, RoutineEntry, RoutineRun } from '@ruimte/contracts';
import { Button, EmptyState, ErrorBoundary, FormError, Icon, KeyValueList, Pill, SectionLabel } from '@adecore/ui';
import { formatDateTime } from '@adecore/ui/format';
import { runtimeModeLabel } from '@adecore/agents-react/chat';
import { AgentIcon, modelName, ProviderLogo } from '@adecore/agents-react/providers';
import { useProvidersStore } from '@adecore/agents-react/state';
import { hasProviderLogo } from '@/agents/provider-logo';
import { ArtifactView } from '@/output/ArtifactView';
import { openArtifact, openArtifactCompared } from '@/output/open';
import { lookOfRun } from '@/routines/agenda';
import { LookIcon } from '@/routines/look';
import { RoutineRunChat } from '@/routines/RoutineRunChat';
import { useRoutineApproval } from '@/routines/routine-approval';
import { useRoutineWhat } from '@/routines/routine-what';
import { leaveRoutines, showRoutine } from '@/routines/stage';
import { runWords, scheduleWords, weekdayClock } from '@/routines/words';
import { useEndpoints } from '@/state/endpoints';
import { isThisMachine } from '@/state/local-machine';

/* A routine opened inside Routines: its definition and runs on the left, the run picked on the right. */
export function RoutineDetail({ endpointId, entry, runId, timeZone }: { endpointId: string; entry: RoutineEntry; runId: string | null; timeZone: string }) {
    const { t } = useTranslation('routines');
    const run = entry.runs.find((candidate) => candidate.runId === runId) ?? entry.runs.find((candidate) => candidate.state !== 'skipped') ?? null;
    return (
        <div className="flex min-h-0 grow">
            <div className="flex w-[440px] shrink-0 flex-col overflow-y-auto border-r border-border">
                <Definition endpointId={endpointId} entry={entry} />
                <RunTimeline entry={entry} picked={run?.runId ?? null} timeZone={timeZone} />
            </div>
            <div className="flex min-w-0 grow flex-col">
                <ErrorBoundary label={t('detail.runFailed')} resetKeys={[run?.runId ?? null]} className="grow">
                    {run === null ? (
                        <div className="grid grow place-items-center">
                            <NoRunYet entry={entry} timeZone={timeZone} />
                        </div>
                    ) : (
                        <RunPane key={run.runId} entry={entry} run={run} timeZone={timeZone} />
                    )}
                </ErrorBoundary>
            </div>
        </div>
    );
}

function NoRunYet({ entry, timeZone }: { entry: RoutineEntry; timeZone: string }) {
    const { t } = useTranslation('routines');
    return <EmptyState>{entry.next === null ? t('detail.noRuns') : t('detail.firstRun', { time: weekdayClock(entry.next, timeZone) })}</EmptyState>;
}

function Definition({ endpointId, entry }: { endpointId: string; entry: RoutineEntry }) {
    const { t } = useTranslation('routines');
    const routine = entry.routine;
    const what = useRoutineWhat(entry);
    const machine = useEndpoints((s) => s.endpoints.find((candidate) => candidate.id === endpointId)?.label ?? '');
    return (
        <section className="flex flex-col gap-3 border-b border-border p-4" aria-label={t('detail.definition')}>
            {entry.held !== undefined && <ApprovalBanner endpointId={endpointId} entry={entry} />}
            {routine.kind === 'agent' && <p className="rounded-lg bg-surface-sunken p-3 text-sm whitespace-pre-wrap text-text select-text">{routine.prompt}</p>}
            {routine.kind === 'command' && (
                <p className="rounded-lg bg-surface-sunken p-3 font-mono text-code whitespace-pre-wrap text-text select-text">{routine.command}</p>
            )}
            <KeyValueList.Root>
                <KeyValueList.Item>
                    <KeyValueList.Name>{t('detail.repeat')}</KeyValueList.Name>
                    <KeyValueList.Value>{scheduleWords(routine.schedule)}</KeyValueList.Value>
                </KeyValueList.Item>
                <KeyValueList.Item>
                    <KeyValueList.Name>{t(`detail.what.${routine.kind}`)}</KeyValueList.Name>
                    <KeyValueList.Value mono={routine.kind !== 'agent'}>
                        {routine.kind === 'agent' ? (
                            <RoutineAgent endpointId={endpointId} provider={routine.provider} model={routine.selection?.model} />
                        ) : routine.kind === 'command' ? (
                            (routine.cwd ?? '.')
                        ) : (
                            what
                        )}
                    </KeyValueList.Value>
                </KeyValueList.Item>
                {routine.kind === 'agent' && (
                    <>
                        <KeyValueList.Item>
                            <KeyValueList.Name>{t('detail.mode')}</KeyValueList.Name>
                            <KeyValueList.Value>{runtimeModeLabel(routine.mode)}</KeyValueList.Value>
                        </KeyValueList.Item>
                        <KeyValueList.Item>
                            <KeyValueList.Name>{t('detail.account')}</KeyValueList.Name>
                            <KeyValueList.Value>{entry.local.account ?? t('detail.defaultAccount')}</KeyValueList.Value>
                        </KeyValueList.Item>
                    </>
                )}
                <KeyValueList.Item>
                    <KeyValueList.Name>{t('detail.runsOn')}</KeyValueList.Name>
                    <KeyValueList.Value>{isThisMachine(endpointId) ? t('detail.thisMachine') : machine}</KeyValueList.Value>
                </KeyValueList.Item>
                <KeyValueList.Item>
                    <KeyValueList.Name>{t('detail.kept')}</KeyValueList.Name>
                    <KeyValueList.Value>{entry.shared ? t('detail.shared') : t('detail.private')}</KeyValueList.Value>
                </KeyValueList.Item>
            </KeyValueList.Root>
        </section>
    );
}

/* The agent a routine starts, by its CLI's mark and the model it picked, as Output names who made a version. */
function RoutineAgent({ endpointId, provider, model }: { endpointId: string; provider: AgentKind; model: string | undefined }) {
    const catalog = useProvidersStore((s) => s.byScope[endpointId]?.providers.find((entry) => entry.kind === provider));
    const name = model === undefined ? (catalog?.name ?? provider) : modelName(model, catalog?.models);
    return (
        <span className="flex min-w-0 items-center gap-1.5">
            {hasProviderLogo(provider) ? <ProviderLogo provider={provider} size={14} /> : <AgentIcon kind={provider} size={14} className="shrink-0" />}
            <span className="truncate">{name}</span>
        </span>
    );
}

function RunTimeline({ entry, picked, timeZone }: { entry: RoutineEntry; picked: string | null; timeZone: string }) {
    const { t } = useTranslation('routines');
    const target = { projectId: entry.projectId, routineId: entry.routine.id };
    return (
        <section className="flex flex-col gap-1 p-3" aria-label={t('detail.runs')}>
            <SectionLabel render={<h3 />} className="flex items-center px-1 pb-1">
                {t('detail.runs')}
                <span className="ml-auto tabular-nums">{entry.runs.length}</span>
            </SectionLabel>
            {entry.next !== null && (
                <div className="flex items-start gap-2 rounded-md px-2 py-1.5">
                    <LookIcon look="next" />
                    <span className="flex min-w-0 grow flex-col">
                        <span className="text-sm text-text">
                            {formatDateTime(entry.next, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone })}
                        </span>
                        <span className="text-xs text-text-muted">{entry.local.pausedAt === undefined ? t('detail.nextRun') : t('row.paused')}</span>
                    </span>
                    <Pill>{t('looks.next')}</Pill>
                </div>
            )}
            {entry.runs.length === 0 && <p className="px-2 text-xs text-text-muted">{t('detail.noRunsYet')}</p>}
            {entry.runs.map((run) => (
                <button
                    key={run.runId}
                    type="button"
                    aria-current={run.runId === picked ? 'true' : undefined}
                    className={`flex items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-hover ${run.runId === picked ? 'bg-surface-active' : ''}`}
                    onClick={() => showRoutine(target, run.runId)}
                >
                    <span className="mt-1">
                        <LookIcon look={lookOfRun(run)} />
                    </span>
                    <span className="flex min-w-0 grow flex-col">
                        <span className="text-sm text-text">
                            {formatDateTime(run.due, { weekday: 'short', day: 'numeric', month: 'short', timeZone })}{' '}
                            <span className="text-text-faint">{formatDateTime(run.at, { hour: '2-digit', minute: '2-digit', timeZone })}</span>
                        </span>
                        <span className="text-xs break-words text-text-muted">{runWords(run, timeZone)}</span>
                    </span>
                    {run.versionNumber !== undefined && <Pill>{t('detail.version', { number: run.versionNumber })}</Pill>}
                </button>
            ))}
        </section>
    );
}

function RunPane({ entry, run, timeZone }: { entry: RoutineEntry; run: RoutineRun; timeZone: string }) {
    const { t } = useTranslation('routines');
    const artifactId = run.artifactId ?? entry.artifactId;
    const previous = entry.runs
        .slice(entry.runs.indexOf(run) + 1)
        .find((candidate) => candidate.versionId !== undefined && candidate.versionId !== run.versionId);
    const [pinned, setPinned] = useState<string | null>(null);
    const open = (): void => {
        if (artifactId !== undefined) {
            leaveRoutines();
            openArtifact(artifactId, entry.routine.title, run.versionId ?? null);
        }
    };
    const compare = (): void => {
        if (artifactId !== undefined && run.versionId !== undefined && previous?.versionId !== undefined) {
            leaveRoutines();
            openArtifactCompared(artifactId, entry.routine.title, run.versionId, previous.versionId);
        }
    };
    return (
        <div className="flex min-h-0 grow flex-col">
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border-soft px-3 text-xs text-text-muted">
                <span className="truncate">
                    {t('detail.runAt', {
                        time: formatDateTime(run.at, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone })
                    })}
                </span>
                <span className="grow" />
                {run.versionNumber !== undefined && artifactId !== undefined && (
                    <>
                        <Pill icon={<Icon icon={Package} size={12} />}>{t('detail.versionOf', { title: entry.routine.title, number: run.versionNumber })}</Pill>
                        <Button size="sm" onClick={open}>
                            <Icon icon={SquareArrowOutUpRight} size={14} />
                            {t('detail.openInOutput')}
                        </Button>
                        <Button size="sm" disabled={previous === undefined} onClick={compare}>
                            <Icon icon={GitCompare} size={14} />
                            {t('detail.compare')}
                        </Button>
                    </>
                )}
            </div>
            {run.chatId !== undefined ? (
                <RoutineRunChat chatId={run.chatId} />
            ) : artifactId !== undefined && run.versionId !== undefined ? (
                <div className="flex min-h-0 grow flex-col">
                    <ArtifactView artifactId={artifactId} pin={{ version: pinned ?? run.versionId, set: setPinned }} />
                </div>
            ) : (
                <div className="grid grow place-items-center">
                    <EmptyState>{runWords(run, timeZone)}</EmptyState>
                </div>
            )}
        </div>
    );
}

/* Over a routine that waits for this person's yes: it runs here only once approved as it stands. */
function ApprovalBanner({ endpointId, entry }: { endpointId: string; entry: RoutineEntry }) {
    const { t } = useTranslation('routines');
    const { origin, busy, failure, approve, decline } = useRoutineApproval(endpointId, entry);
    return (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-raised bg-clip-padding p-3" role="status">
            <span className="flex items-center gap-2 text-sm font-medium text-text">
                <Icon icon={Hand} size={14} className="text-status-needs-you" />
                {t('row.held')}
            </span>
            <span className="text-xs text-text-muted">{origin}</span>
            {failure !== null && <FormError className="break-words">{failure}</FormError>}
            <span className="flex items-center justify-end gap-1.5">
                <Button size="sm" disabled={busy} onClick={decline}>
                    {t('approval.deny')}
                </Button>
                <Button size="sm" variant="secondary" disabled={busy} onClick={approve}>
                    <Icon icon={CircleCheck} size={14} />
                    {t('approval.approve')}
                </Button>
            </span>
        </div>
    );
}
