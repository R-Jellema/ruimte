import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, CircleAlert, Eraser, Folder, Package, Server, Trash2 } from 'lucide-react';
import type { ArtifactCleanupProposal, ArtifactStorageResult } from '@ruimte/contracts';
import { Button, ErrorBoundary, Icon, Menu, SegmentBar } from '@adecore/ui';
import { formatBytes } from '@adecore/ui/format';
import { SettingsRow, TopIcon } from '@adecore/ui/settings';
import { create } from 'zustand';
import { holdArtifacts, useArtifacts } from '@/output/artifacts';
import { OutputProjectGlyph } from '@/output/look';
import { showProjectOutput } from '@/output/open';
import { CleanupReviewDialog } from '@/shell/settings/panes/CleanupReviewDialog';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { useEndpoints, type Endpoint } from '@/state/endpoints';
import { endpointKey } from '@/state/keys';
import { listedEndpoints } from '@/state/local-machine';
import { useProject } from '@/state/project';
import { useUi } from '@/state/ui';
import { machineTransport, pool } from '@/transport';
import { machineAnswers } from '@/transport/features';
import { useEndpointConnection, useMachineHold } from '@/transport/status';
import { isConnectionError } from '@/transport/transport';

// The categorical series of the theme, a project per color in the order of their size.
const SERIES = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)'];

/* The proposals a person put off with Not now, by `endpointKey(endpointId, proposalId)`; for as long as this page lives and nowhere else. */
const useDeferredProposals = create<{ deferred: ReadonlySet<string> }>(() => ({ deferred: new Set() }));

function deferProposal(key: string): void {
    useDeferredProposals.setState((state) => ({ deferred: new Set([...state.deferred, key]) }));
}

type StorageReading =
    | { status: 'loading' }
    | { status: 'unreachable' }
    | { status: 'tooOld' }
    | { status: 'failed' }
    | { status: 'ready'; storage: ArtifactStorageResult; proposals: ArtifactCleanupProposal[] };

const LOADING: StorageReading = { status: 'loading' };
const UNREACHABLE: StorageReading = { status: 'unreachable' };
const TOO_OLD: StorageReading = { status: 'tooOld' };

function changesOn(revisions: Readonly<Record<string, number>>, endpointId: string): number {
    const prefix = endpointKey(endpointId, '');
    let sum = 0;
    for (const [key, count] of Object.entries(revisions)) {
        if (key.startsWith(prefix)) {
            sum += count;
        }
    }
    return sum;
}

/* What one machine keeps and proposes to let go, read again whenever it says something in Output changed. */
function useStorage(endpointId: string, attempt: number): StorageReading {
    const connection = useEndpointConnection(endpointId);
    const open = connection.status === 'open';
    const answers = machineAnswers(connection, 'artifact.storage');
    const changes = useArtifacts((state) => changesOn(state.revisions, endpointId));
    const [held, setHeld] = useState<{ key: string; reading: StorageReading } | null>(null);

    useEffect(() => (answers ? holdArtifacts(endpointId, null) : undefined), [endpointId, answers]);

    useEffect(() => {
        if (!open || !answers) {
            return;
        }
        let live = true;
        const transport = machineTransport(endpointId);
        const proposals = machineAnswers(pool.statusOf(endpointId), 'artifact.cleanup')
            ? transport.request('artifact.cleanup', { mode: 'preview' }).then((result) => result.proposals ?? [])
            : Promise.resolve([]);
        Promise.all([transport.request('artifact.storage', {}), proposals])
            .then(([storage, list]) => {
                if (live) {
                    setHeld({ key: endpointId, reading: { status: 'ready', storage, proposals: list } });
                }
            })
            .catch((error: unknown) => {
                if (live) {
                    setHeld({ key: endpointId, reading: isConnectionError(error) ? UNREACHABLE : { status: 'failed' } });
                }
            });
        return () => {
            live = false;
        };
    }, [endpointId, open, answers, changes, attempt]);

    if (!open) {
        return connection.status === 'closed' || connection.attempts > 0 ? UNREACHABLE : LOADING;
    }
    if (!answers) {
        return TOO_OLD;
    }
    return held !== null && held.key === endpointId ? held.reading : LOADING;
}

/* What Ruimte keeps in Output on a machine of the account, and the versions a person may let go. */
export function StoragePane() {
    const { t } = useTranslation('settings');
    return (
        <ErrorBoundary label={t('storage.failed')} className="relative" compact>
            <StorageSections />
        </ErrorBoundary>
    );
}

function StorageSections() {
    const { t } = useTranslation('settings');
    const stored = useEndpoints((s) => s.endpoints);
    const activeId = useEndpoints((s) => s.activeId);
    const endpoints = listedEndpoints(stored);
    const [chosen, setChosen] = useState<string | null>(null);
    const endpoint = endpoints.find((entry) => entry.id === (chosen ?? activeId)) ?? endpoints[0] ?? null;
    // Choosing a machine is a look at it, so its link opens for as long as the pane shows it.
    useMachineHold(endpoint);
    if (endpoint === null) {
        return null;
    }
    return (
        <MachineStorage
            key={endpoint.id}
            endpoint={endpoint}
            picker={<MachinePicker endpoints={endpoints} value={endpoint.id} label={t('storage.output.machine')} onChange={setChosen} />}
        />
    );
}

function MachinePicker({ endpoints, value, label, onChange }: { endpoints: readonly Endpoint[]; value: string; label: string; onChange(id: string): void }) {
    const current = endpoints.find((entry) => entry.id === value);
    return (
        <Menu.Root>
            <Menu.Trigger render={<Button size="sm" variant="secondary" aria-label={label} />}>
                <Icon icon={Server} size={14} />
                <span className="max-w-40 truncate">{current?.label}</span>
                <Icon icon={ChevronDown} size={12} />
            </Menu.Trigger>
            <Menu.Popup align="end" className="min-w-48">
                <Menu.RadioGroup value={value} onValueChange={(next: string) => onChange(next)}>
                    {endpoints.map((entry) => (
                        <Menu.RadioItem key={entry.id} value={entry.id}>
                            <span className="grow truncate">{entry.label}</span>
                        </Menu.RadioItem>
                    ))}
                </Menu.RadioGroup>
            </Menu.Popup>
        </Menu.Root>
    );
}

function MachineStorage({ endpoint, picker }: { endpoint: Endpoint; picker: ReactNode }) {
    const { t } = useTranslation('settings');
    const [attempt, setAttempt] = useState(0);
    const reading = useStorage(endpoint.id, attempt);
    const machine = endpoint.label;
    const outputSection = (children: ReactNode) => (
        <SettingsSection title={t('storage.output.title')} description={t('storage.output.description')} icon={Package} action={picker}>
            {children}
        </SettingsSection>
    );

    if (reading.status !== 'ready') {
        const line =
            reading.status === 'loading'
                ? t('storage.state.loading', { machine })
                : reading.status === 'unreachable'
                  ? t('storage.state.unreachable', { machine })
                  : reading.status === 'tooOld'
                    ? t('storage.state.tooOld', { machine })
                    : t('storage.state.failed', { machine });
        return outputSection(
            <SettingsRow
                searchId="storage.output"
                muted
                leading={reading.status === 'loading' ? undefined : <TopIcon icon={CircleAlert} className="text-text-faint" />}
                label={line}
                control={
                    reading.status === 'failed' && (
                        <Button variant="secondary" onClick={() => setAttempt(attempt + 1)}>
                            {t('storage.state.retry')}
                        </Button>
                    )
                }
            />
        );
    }

    const { storage, proposals } = reading;
    const projects = [...storage.projects].sort((a, b) => b.bytes - a.bytes);
    return (
        <>
            {outputSection(
                <SettingsRow
                    searchId="storage.output"
                    label={t('storage.output.on', { machine })}
                    control={<span className="text-sm font-medium text-text tabular-nums">{formatBytes(storage.total.bytes)}</span>}
                >
                    <div className="flex flex-col gap-2 pt-2">
                        {storage.total.bytes > 0 && (
                            <SegmentBar
                                size="sm"
                                label={t('storage.output.bar')}
                                parts={projects.map((project, index) => ({
                                    value: project.bytes,
                                    label: `${project.projectName}, ${formatBytes(project.bytes)}`,
                                    color: SERIES[index % SERIES.length]
                                }))}
                            />
                        )}
                        {storage.disk !== null && (
                            <span className="text-xs text-text-faint tabular-nums">{t('storage.output.free', { size: formatBytes(storage.disk.free) })}</span>
                        )}
                    </div>
                </SettingsRow>
            )}
            <Proposals endpointId={endpoint.id} machine={machine} proposals={proposals} onRemoved={() => setAttempt(attempt + 1)} />
            <ByProject endpointId={endpoint.id} machine={machine} projects={projects} />
        </>
    );
}

function Proposals({
    endpointId,
    machine,
    proposals,
    onRemoved
}: {
    endpointId: string;
    machine: string;
    proposals: readonly ArtifactCleanupProposal[];
    onRemoved(): void;
}) {
    const { t } = useTranslation('settings');
    const deferred = useDeferredProposals((s) => s.deferred);
    const [reviewing, setReviewing] = useState<ArtifactCleanupProposal | null>(null);
    const shown = proposals.filter((proposal) => !deferred.has(endpointKey(endpointId, proposal.id)));
    return (
        <SettingsSection title={t('storage.cleanup.title')} description={t('storage.cleanup.description')} icon={Eraser}>
            {shown.length === 0 ? (
                <SettingsRow searchId="storage.cleanup" muted label={t('storage.cleanup.nothing')} />
            ) : (
                shown.map((proposal, index) => {
                    return (
                        <SettingsRow
                            key={proposal.id}
                            searchId={index === 0 ? 'storage.cleanup' : undefined}
                            leading={<TopIcon icon={Trash2} className="text-text-faint" />}
                            label={t('storage.cleanup.proposal', { title: proposal.title })}
                            description={t('storage.cleanup.frees', { count: proposal.versions.length, size: formatBytes(proposal.bytes) })}
                            control={
                                <span className="flex items-center gap-2">
                                    <Button variant="ghost" onClick={() => deferProposal(endpointKey(endpointId, proposal.id))}>
                                        {t('storage.cleanup.notNow')}
                                    </Button>
                                    <Button variant="secondary" onClick={() => setReviewing(proposal)}>
                                        {t('storage.cleanup.review')}
                                    </Button>
                                </span>
                            }
                        />
                    );
                })
            )}
            {reviewing !== null && (
                <CleanupReviewDialog
                    endpointId={endpointId}
                    machine={machine}
                    proposal={reviewing}
                    onClose={() => setReviewing(null)}
                    onRemoved={() => {
                        setReviewing(null);
                        onRemoved();
                    }}
                />
            )}
        </SettingsSection>
    );
}

function ByProject({ endpointId, machine, projects }: { endpointId: string; machine: string; projects: ArtifactStorageResult['projects'] }) {
    const { t } = useTranslation('settings');
    const windowMachine = useEndpoints((s) => s.activeId);
    const inWorkspace = useProject((s) => s.current !== null);
    // The Output panel is the window's and lists the window's machine, so only that machine's projects can be shown in it.
    const showable = inWorkspace && windowMachine === endpointId;
    const show = (projectId: string): void => {
        useUi.getState().setSettings({ open: false });
        showProjectOutput(projectId);
    };
    return (
        <SettingsSection
            title={t('storage.projects.title')}
            icon={Folder}
            footer={
                <>
                    {t('storage.projects.footer')}
                    {!showable && projects.length > 0 && <span className="mt-1 block">{t('storage.projects.elsewhere', { machine })}</span>}
                </>
            }
        >
            {projects.length === 0 ? (
                <SettingsRow searchId="storage.projects" muted label={t('storage.projects.empty')} />
            ) : (
                projects.map((project, index) => (
                    <SettingsRow
                        key={project.projectId}
                        searchId={index === 0 ? 'storage.projects' : undefined}
                        leading={
                            <span className="flex h-5.5 items-center">
                                <OutputProjectGlyph endpointId={endpointId} projectId={project.projectId} size={16} />
                            </span>
                        }
                        label={
                            <span className="flex min-w-0 items-center gap-2">
                                <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ backgroundColor: SERIES[index % SERIES.length] }} />
                                <span className="truncate">{project.projectName}</span>
                            </span>
                        }
                        description={t('storage.projects.counts', {
                            artifacts: t('storage.projects.artifacts', { count: project.artifacts }),
                            versions: t('storage.projects.versions', { count: project.versions })
                        })}
                        control={
                            <span className="flex items-center gap-2">
                                <span className="text-sm text-text-muted tabular-nums">{formatBytes(project.bytes)}</span>
                                {showable && (
                                    <Button variant="secondary" onClick={() => show(project.projectId)}>
                                        {t('storage.projects.show')}
                                    </Button>
                                )}
                            </span>
                        }
                    />
                ))
            )}
        </SettingsSection>
    );
}
