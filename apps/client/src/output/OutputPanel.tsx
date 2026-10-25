import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Bot,
    ChevronDown,
    ChevronRight,
    CircleAlert,
    HardDrive,
    LayoutGrid,
    ListFilter,
    Package,
    Search,
    User,
    CalendarClock,
    type LucideIcon
} from 'lucide-react';
import type { ArtifactSummary } from '@ruimte/contracts';
import { Button, ButtonGroup, Icon, IconButton, Input, Menu, PanelEmpty, Pill, SectionLabel, useNow } from '@adecore/ui';
import { formatBytes, formatDayClock, formatMoment } from '@adecore/ui/format';
import {
    ALL,
    DATES,
    defaultFilters,
    filtersChanged,
    groupByDate,
    KINDS,
    matchesFilters,
    projectsOf,
    routinesOf,
    SIZES,
    SOURCES,
    type ArtifactSource,
    type OutputFilters
} from '@/output/artifact-list';
import { useArtifactList } from '@/output/artifacts';
import { useChatName } from '@/output/kinds';
import { KindTile, OutputProjectGlyph } from '@/output/look';
import { openArtifact, useOutputRequest } from '@/output/open';
import { useArtifact } from '@/output/use-artifact';
import { PanelHeaderSlot } from '@/shell/PanelHeaderSlot';
import { useEndpointId } from '@/state/keys';
import { useProject } from '@/state/project';
import { useUi } from '@/state/ui';
import { useMachineAnswers } from '@/transport/features';

const MINUTE_MS = 60_000;
// The versions a row shows when it opens; the rest are in the artifact's own view.
const SHOWN_VERSIONS = 5;

const SOURCE_ICONS: Record<ArtifactSource, LucideIcon> = { agent: Bot, person: User, routine: CalendarClock };

const NO_ARTIFACTS: readonly ArtifactSummary[] = [];

/*
 * Everything the machine keeps in Output, the window's project first. A row opens the artifact as a
 * view; its chevron shows the latest versions under it. Filters beyond a project are the client's.
 */
export function OutputPanel() {
    const { t } = useTranslation('output');
    const endpointId = useEndpointId();
    const answers = useMachineAnswers(endpointId, 'artifact.list');
    const projectId = useProject((s) => s.current?.projectId ?? null);
    const list = useArtifactList(endpointId, {}, answers);
    const request = useOutputRequest((s) => s.project);
    const [filters, setFilters] = useState<OutputFilters>(() => ({
        ...defaultFilters(projectId),
        ...(request === null ? {} : { project: request.projectId })
    }));
    const [taken, setTaken] = useState(request);
    // A request that came while the panel was already open sets the filters the way a person would.
    if (request !== null && request !== taken) {
        setTaken(request);
        setFilters({ ...defaultFilters(projectId), project: request.projectId });
    }
    useEffect(() => {
        if (request !== null) {
            useOutputRequest.setState({ project: null });
        }
    }, [request]);
    const [searchOpen, setSearchOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
    const now = useNow(MINUTE_MS);

    const artifacts = list?.status === 'ready' ? list.artifacts : NO_ARTIFACTS;
    const header = (
        <PanelHeaderSlot>
            <span className="grow" />
            <ButtonGroup>
                <IconButton icon={Search} label={t('panel.search')} active={searchOpen} onClick={() => setSearchOpen(!searchOpen)} />
                <FiltersMenu artifacts={artifacts} filters={filters} projectId={projectId} onChange={setFilters} />
            </ButtonGroup>
        </PanelHeaderSlot>
    );

    if (list === null) {
        return (
            <>
                {header}
                <PanelEmpty icon={CircleAlert}>{t('panel.tooOld')}</PanelEmpty>
            </>
        );
    }
    if (list.status === 'loading') {
        return (
            <>
                {header}
                <PanelEmpty busy>{t('panel.loading')}</PanelEmpty>
            </>
        );
    }
    if (list.status === 'failed') {
        return (
            <>
                {header}
                <PanelEmpty icon={CircleAlert}>{t('panel.failed')}</PanelEmpty>
            </>
        );
    }

    const shown = list.artifacts.filter((artifact) => matchesFilters(artifact, filters, query, now));
    const everywhere = filters.project === ALL;
    const shownBytes = shown.reduce((sum, artifact) => sum + artifact.totalBytes, 0);
    const toggle = (artifactId: string): void => {
        const next = new Set(expanded);
        if (!next.delete(artifactId)) {
            next.add(artifactId);
        }
        setExpanded(next);
    };

    return (
        <>
            {header}
            <ScopeLine
                endpointId={endpointId}
                artifacts={list.artifacts}
                filters={filters}
                projectId={projectId}
                onReset={() => setFilters(defaultFilters(projectId))}
            />
            {searchOpen && (
                <div className="flex shrink-0 px-2 pt-2">
                    <Input
                        icon={Search}
                        className="min-w-0 grow"
                        placeholder={t('panel.search')}
                        aria-label={t('panel.search')}
                        spellCheck={false}
                        autoFocus
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Escape' && query !== '') {
                                event.stopPropagation();
                                setQuery('');
                            }
                        }}
                    />
                </div>
            )}
            <div className="min-h-0 grow overflow-y-auto px-2 pb-2">
                {list.artifacts.length === 0 ? (
                    <PanelEmpty icon={Package} fill="full">
                        <span className="flex flex-col gap-1">
                            <span className="text-text">{t('panel.emptyTitle')}</span>
                            <span>{t('panel.empty')}</span>
                        </span>
                    </PanelEmpty>
                ) : shown.length === 0 ? (
                    <PanelEmpty fill="full">{t('panel.noMatch')}</PanelEmpty>
                ) : (
                    groupByDate(shown, now).map(({ group, artifacts }) => (
                        <section key={group} className="flex flex-col gap-0.5" aria-label={t(`panel.groups.${group}`)}>
                            <SectionLabel render={<h3 />} className="px-2 pt-3 pb-1">
                                {t(`panel.groups.${group}`)}
                            </SectionLabel>
                            {artifacts.map((artifact) => (
                                <ArtifactRow
                                    key={artifact.artifactId}
                                    endpointId={endpointId}
                                    artifact={artifact}
                                    everywhere={everywhere}
                                    open={expanded.has(artifact.artifactId)}
                                    onToggle={() => toggle(artifact.artifactId)}
                                    now={now}
                                />
                            ))}
                        </section>
                    ))
                )}
            </div>
            <div className="flex h-9 shrink-0 items-center gap-2 border-t border-border px-3 text-xs text-text-muted">
                <Icon icon={HardDrive} size={14} className="shrink-0 text-text-faint" />
                <span className="grow truncate tabular-nums">{t('panel.shown', { count: shown.length, size: formatBytes(shownBytes) })}</span>
                <Button size="xs" variant="ghost" onClick={() => useUi.getState().setSettings({ open: true, section: 'storage' })}>
                    {t('panel.storage')}
                </Button>
            </div>
        </>
    );
}

function ArtifactRow({
    endpointId,
    artifact,
    everywhere,
    open,
    onToggle,
    now
}: {
    endpointId: string;
    artifact: ArtifactSummary;
    everywhere: boolean;
    open: boolean;
    onToggle(): void;
    now: number;
}) {
    const { t } = useTranslation('output');
    const maker = artifact.latest.provenance.maker;
    const chatName = useChatName(artifact.latest.provenance.chatId);
    const source = chatName !== null && chatName !== '' ? chatName : t(`source.${maker}`);
    const several = artifact.versionCount > 1;
    return (
        <div className="flex flex-col">
            <div className="group flex items-start gap-2.5 rounded-md px-2 py-2 hover:bg-surface-hover">
                <button
                    type="button"
                    className="flex min-w-0 grow items-start gap-2.5 text-left"
                    onClick={() => openArtifact(artifact.artifactId, artifact.title)}
                >
                    <KindTile kind={artifact.kind} />
                    <span className="flex min-w-0 grow flex-col">
                        <span className="truncate text-sm font-medium text-text">{artifact.title}</span>
                        <span className="flex min-w-0 items-center gap-1 text-xs text-text-muted">
                            {everywhere ? (
                                <>
                                    <OutputProjectGlyph endpointId={endpointId} projectId={artifact.projectId} />
                                    <span className="max-w-28 shrink-0 truncate">{artifact.projectName},</span>
                                </>
                            ) : (
                                <Icon icon={SOURCE_ICONS[maker]} size={12} className="shrink-0 text-text-faint" />
                            )}
                            <span className="truncate">
                                {t('panel.versions', { count: artifact.versionCount })}
                                {everywhere ? '' : `, ${source}`}
                            </span>
                        </span>
                    </span>
                    <span className="shrink-0 text-xs text-text-faint tabular-nums">{formatMoment(artifact.latest.createdAt, now)}</span>
                </button>
                {several && (
                    <IconButton
                        icon={open ? ChevronDown : ChevronRight}
                        size="sm"
                        label={open ? t('panel.hideVersions') : t('panel.showVersions')}
                        aria-expanded={open}
                        onClick={onToggle}
                    />
                )}
            </div>
            {open && several && <VersionRows endpointId={endpointId} artifact={artifact} />}
        </div>
    );
}

/* The latest versions of one artifact, read when the row opens. */
function VersionRows({ endpointId, artifact }: { endpointId: string; artifact: ArtifactSummary }) {
    const { t } = useTranslation('output');
    const state = useArtifact(endpointId, artifact.artifactId, true);
    if (state.status !== 'ready') {
        return null;
    }
    const versions = state.result.versions;
    const older = versions.length - SHOWN_VERSIONS;
    return (
        <div className="ml-10 flex flex-col pb-1">
            {versions.slice(0, SHOWN_VERSIONS).map((version, index) => (
                <button
                    key={version.versionId}
                    type="button"
                    className="flex h-7 items-center gap-2 rounded-md px-2 text-left text-xs text-text hover:bg-surface-hover"
                    onClick={() => openArtifact(artifact.artifactId, artifact.title, index === 0 ? null : version.versionId)}
                >
                    <span className="truncate tabular-nums">{formatDayClock(version.createdAt)}</span>
                    <span className="grow" />
                    {index === 0 && (
                        <Pill tone="accent" size="sm">
                            {t('view.latest')}
                        </Pill>
                    )}
                    <span className="shrink-0 text-text-faint tabular-nums">{formatBytes(version.bytes)}</span>
                </button>
            ))}
            {older > 0 && (
                <button
                    type="button"
                    className="flex h-7 items-center rounded-md px-2 text-left text-xs text-text-faint hover:bg-surface-hover"
                    onClick={() => openArtifact(artifact.artifactId, artifact.title)}
                >
                    {t('panel.older', { count: older })}
                </button>
            )}
        </div>
    );
}

/* The name a project filter reads as: the one Output knows it by, or the window's own before it has anything there. */
function useProjectName(artifacts: readonly ArtifactSummary[], projectId: string | null): (id: string) => string {
    const currentName = useProject((s) => s.current?.name ?? '');
    const projects = projectsOf(artifacts);
    return (id: string): string => projects.find((entry) => entry.projectId === id)?.projectName ?? (id === projectId ? currentName : '');
}

/* How many filters beyond the project narrow the list. */
function narrowing(filters: OutputFilters): number {
    return [filters.kind, filters.source, filters.routine, filters.date, filters.size].filter((value) => value !== ALL).length;
}

/* What the list is narrowed to, only while it differs from where the panel starts, with the way back. */
function ScopeLine({
    endpointId,
    artifacts,
    filters,
    projectId,
    onReset
}: {
    endpointId: string;
    artifacts: readonly ArtifactSummary[];
    filters: OutputFilters;
    projectId: string | null;
    onReset(): void;
}) {
    const { t } = useTranslation('output');
    const projectName = useProjectName(artifacts, projectId);
    if (!filtersChanged(filters, projectId)) {
        return null;
    }
    const count = narrowing(filters);
    const otherProject = filters.project !== defaultFilters(projectId).project;
    return (
        <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border pr-1 pl-3 text-xs text-text-muted">
            {otherProject && (
                <>
                    {filters.project === ALL ? (
                        <Icon icon={LayoutGrid} size={12} className="shrink-0 text-text-faint" />
                    ) : (
                        <OutputProjectGlyph endpointId={endpointId} projectId={filters.project} size={12} />
                    )}
                    <span className="min-w-0 truncate">{filters.project === ALL ? t('panel.filter.allProjects') : projectName(filters.project)}</span>
                </>
            )}
            {otherProject && count > 0 && (
                <span aria-hidden="true" className="text-text-faint">
                    ·
                </span>
            )}
            {count > 0 && <span className="shrink-0">{t('panel.narrowed', { count })}</span>}
            <span className="grow" />
            <Button size="xs" variant="ghost" onClick={onReset}>
                {t('panel.reset')}
            </Button>
        </div>
    );
}

/* Every filter in one menu behind the header's button, which stands out while any of them differs from where the panel starts. */
function FiltersMenu({
    artifacts,
    filters,
    projectId,
    onChange
}: {
    artifacts: readonly ArtifactSummary[];
    filters: OutputFilters;
    projectId: string | null;
    onChange(filters: OutputFilters): void;
}) {
    const { t } = useTranslation('output');
    const currentName = useProject((s) => s.current?.name ?? '');
    const projects = projectsOf(artifacts);
    const routines = routinesOf(artifacts);
    const projectName = useProjectName(artifacts, projectId);
    const changed = filtersChanged(filters, projectId);
    const set = (patch: Partial<OutputFilters>): void => onChange({ ...filters, ...patch });
    const projectOptions = [
        { value: ALL, label: t('panel.filter.allProjects') },
        ...projects.map((entry) => ({
            value: entry.projectId,
            label: entry.projectId === projectId ? t('panel.filter.thisProject', { name: entry.projectName }) : entry.projectName,
            hint: formatBytes(entry.bytes)
        }))
    ];
    // The window's project is a choice even before it has anything in Output, since it is where the panel starts.
    if (projectId !== null && !projects.some((entry) => entry.projectId === projectId)) {
        projectOptions.splice(1, 0, { value: projectId, label: t('panel.filter.thisProject', { name: currentName }) });
    }
    return (
        <Menu.Root>
            <IconButton icon={ListFilter} label={t('panel.filters')} active={changed} render={<Menu.Trigger />} />
            <Menu.Popup align="end" className="min-w-56">
                <FilterSubmenu
                    title={t('panel.filter.project')}
                    label={filters.project === ALL ? t('panel.filter.allProjects') : projectName(filters.project)}
                    value={filters.project}
                    options={projectOptions}
                    onChange={(project) => set({ project })}
                />
                <FilterSubmenu
                    title={t('panel.filter.kind')}
                    label={filters.kind === ALL ? t('panel.filter.allKinds') : t(`kinds.${filters.kind}`)}
                    value={filters.kind}
                    options={[{ value: ALL, label: t('panel.filter.allKinds') }, ...KINDS.map((kind) => ({ value: kind, label: t(`kinds.${kind}`) }))]}
                    onChange={(kind) => set({ kind: kind as OutputFilters['kind'] })}
                />
                <FilterSubmenu
                    title={t('panel.filter.source')}
                    label={filters.source === ALL ? t('panel.filter.anySource') : t(`panel.filter.sources.${filters.source}`)}
                    value={filters.source}
                    options={[
                        { value: ALL, label: t('panel.filter.anySource') },
                        ...SOURCES.map((source) => ({ value: source, label: t(`panel.filter.sources.${source}`) }))
                    ]}
                    onChange={(source) => set({ source: source as OutputFilters['source'] })}
                />
                {routines.length > 0 && (
                    <FilterSubmenu
                        title={t('panel.filter.routine')}
                        label={filters.routine === ALL ? t('panel.filter.anyRoutine') : filters.routine}
                        value={filters.routine}
                        options={[{ value: ALL, label: t('panel.filter.anyRoutine') }, ...routines.map((routine) => ({ value: routine, label: routine }))]}
                        onChange={(routine) => set({ routine })}
                    />
                )}
                <FilterSubmenu
                    title={t('panel.filter.time')}
                    label={filters.date === ALL ? t('panel.filter.anyTime') : t(`panel.filter.dates.${filters.date}`)}
                    value={filters.date}
                    options={DATES.map((date) => ({ value: date, label: date === ALL ? t('panel.filter.anyTime') : t(`panel.filter.dates.${date}`) }))}
                    onChange={(date) => set({ date: date as OutputFilters['date'] })}
                />
                <FilterSubmenu
                    title={t('panel.filter.size')}
                    label={filters.size === ALL ? t('panel.filter.anySize') : t(`panel.filter.sizes.${filters.size}`)}
                    value={filters.size}
                    options={SIZES.map((size) => ({ value: size, label: size === ALL ? t('panel.filter.anySize') : t(`panel.filter.sizes.${size}`) }))}
                    onChange={(size) => set({ size: size as OutputFilters['size'] })}
                />
                <Menu.Separator />
                <Menu.Item disabled={!changed} onClick={() => onChange(defaultFilters(projectId))}>
                    {t('panel.reset')}
                </Menu.Item>
            </Menu.Popup>
        </Menu.Root>
    );
}

/* One filter as a row of the menu that says what it is set to and opens its choices. */
function FilterSubmenu({
    title,
    label,
    value,
    options,
    onChange
}: {
    title: string;
    label: string;
    value: string;
    options: readonly { value: string; label: string; hint?: string }[];
    onChange(value: string): void;
}) {
    return (
        <Menu.SubmenuRoot>
            <Menu.SubmenuTrigger>
                <span className="grow">{title}</span>
                <Menu.Hint className="max-w-36 truncate">{label}</Menu.Hint>
            </Menu.SubmenuTrigger>
            <Menu.Popup className="max-h-72 min-w-48 overflow-y-auto">
                <Menu.RadioGroup value={value} onValueChange={(next: string) => onChange(next)}>
                    {options.map((option) => (
                        <Menu.RadioItem key={option.value} value={option.value}>
                            <span className="grow truncate">{option.label}</span>
                            {option.hint !== undefined && <Menu.Hint>{option.hint}</Menu.Hint>}
                        </Menu.RadioItem>
                    ))}
                </Menu.RadioGroup>
            </Menu.Popup>
        </Menu.SubmenuRoot>
    );
}
