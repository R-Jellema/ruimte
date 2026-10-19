import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import {
    ArrowDown,
    ArrowUp,
    ChevronDown,
    ChevronRight,
    CircleAlert,
    Eye,
    FilePen,
    FilePlus,
    Folder,
    FolderX,
    GitBranch,
    GitMerge,
    LocateFixed,
    Lock,
    MoreHorizontal,
    ScanSearch,
    Trash
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Worktree } from '@ruimte/contracts';
import { StatusDot } from '@/canvas/NodeFrame';
import { nodesInWorktree, originLabel, removeVerdict, workBadges, workBadgesLabel, type RemoveVerdict, type WorkBadgeKind } from '@/shell/panels/worktree-rows';
import { nodeWorking } from '@/state/agent-work';
import { hasActiveCanvas, useDocument } from '@/state/document';
import { useChats } from '@adecore/agents-react/state';
import { useEndpointId } from '@/state/keys';
import { useSessions } from '@/state/sessions';
import { useTransport } from '@/transport/context';
import { worktreeLists, type WorktreeNode } from '@/state/worktrees';
import { Button, Dialog, Icon, IconButton, ListRow, SectionLabel, Spinner, Tooltip, Menu, ContextMenu } from '@adecore/ui';
import { formatNumber } from '@adecore/ui/format';

/* The mark per kind of work. The number beside it carries the amount; the tooltip carries the words. */
const BADGE_MARKS: Record<WorkBadgeKind, LucideIcon> = {
    operation: CircleAlert,
    changed: FilePen,
    untracked: FilePlus,
    ahead: ArrowUp,
    behind: ArrowDown
};

interface WorktreeSectionProps {
    /* The project folder the list is held for. */
    folder: string;
    worktrees: readonly Worktree[];
    /* Every node of the project, on every canvas, so a row can name the node working in it. */
    nodes: readonly WorktreeNode[];
    /* The worktree the panel is in, so its row reads as picked; null marks the project folder instead. */
    current: string | null;
    /* How many repositories the project folder holds, which its row says beside its name. */
    repoCount: number;
    open: boolean;
    busy: boolean;
    onToggle(open: boolean): void;
    /* Leaves the worktree for the repositories of the project folder. */
    onLeave(): void;
    onView(worktree: Worktree): void;
    onMerge(worktree: Worktree): void;
    onRemove(worktree: Worktree): void;
    onReveal(nodeId: string): void;
}

/*
 * The worktrees of the project's repository, each with the node that works in it and the work it
 * holds. It is the one place a worktree whose node is gone still shows up, which is what an agent
 * team leaves behind once its canvas is cleaned up.
 */
export function WorktreeSection({
    folder,
    worktrees,
    nodes,
    current,
    repoCount,
    open,
    busy,
    onToggle,
    onLeave,
    onView,
    onMerge,
    onRemove,
    onReveal
}: WorktreeSectionProps) {
    const { t } = useTranslation('panels');
    const endpointId = useEndpointId();
    const transport = useTransport();
    const [inspected, setInspected] = useState<{ worktree: Worktree; verdict: RemoveVerdict | null } | null>(null);
    // Goes up on every start and on close, so an answer that lands after the dialog was left is dropped.
    const inspection = useRef(0);
    const sessions = useSessions((s) => s.byKey);
    const chats = useChats((s) => s.statusByKey);
    const sectionRef = useRef<HTMLElement>(null);
    const shown = worktrees.length > 0;

    useEffect(() => {
        const section = sectionRef.current;
        if (!shown || section === null) {
            return;
        }
        // Sliding or scrolling back into view is when the counts on screen may have gone stale.
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
                worktreeLists.refreshCounts(endpointId, folder);
            }
        });
        observer.observe(section);
        return () => observer.disconnect();
    }, [shown, endpointId, folder]);

    if (worktrees.length === 0) {
        return null;
    }

    const closeInspection = (): void => {
        inspection.current++;
        setInspected(null);
    };

    /* Counts the work again and says whether the worktree can go, so a person knows before the question. */
    const inspect = (worktree: Worktree, agentWorking: boolean): void => {
        worktreeLists.refreshCounts(endpointId, folder);
        const attempt = ++inspection.current;
        setInspected({ worktree, verdict: null });
        transport
            .request('git.worktree-list', { repo: folder, inspect: true })
            .then((answer) => {
                if (attempt === inspection.current) {
                    const fresh = answer.worktrees.find((entry) => entry.path === worktree.path) ?? worktree;
                    setInspected({ worktree: fresh, verdict: removeVerdict(fresh, agentWorking) });
                }
            })
            .catch((error: unknown) => {
                if (attempt === inspection.current) {
                    setInspected({
                        worktree,
                        verdict: { removable: false, reason: error instanceof Error ? error.message : t('worktree.verdict.failed') }
                    });
                }
            });
    };

    const agents = new Set(
        worktrees.flatMap((worktree) =>
            nodesInWorktree(nodes, worktree)
                .filter((node) => nodeWorking(node, sessions, chats, endpointId))
                .map((node) => node.id)
        )
    ).size;
    const stopped = worktrees.filter((worktree) => worktree.work?.operation !== undefined).length;

    return (
        <section ref={sectionRef} className="flex max-h-48 shrink-0 flex-col border-b border-border">
            <button
                type="button"
                className="flex h-8 w-full shrink-0 items-center gap-2 pr-3 pl-2 text-left hover:bg-surface-hover"
                aria-expanded={open}
                onClick={() => onToggle(!open)}
            >
                <Icon icon={open ? ChevronDown : ChevronRight} size={14} className="shrink-0 text-text-faint" />
                <SectionLabel>{t('worktree.section.title')}</SectionLabel>
                <span className="text-xs text-text-faint tabular-nums">{formatNumber(worktrees.length)}</span>
                <span className="grow" />
                {/* Folded, the section still says what asks for a look inside it. */}
                {!open && agents > 0 && (
                    <span className="flex min-w-0 items-center gap-1.5 text-xs text-text-muted">
                        <StatusDot status="running" />
                        <span className="truncate">{t('worktree.section.agents', { count: agents })}</span>
                    </span>
                )}
                {!open && stopped > 0 && (
                    <span className="flex shrink-0 items-center gap-1 text-xs text-status-needs-you tabular-nums">
                        <Icon icon={CircleAlert} size={12} />
                        {t('worktree.section.needsYou', { count: stopped })}
                    </span>
                )}
            </button>
            {open && (
                <ul className="min-h-0 overflow-y-auto pb-1">
                    <ListRow
                        variant="flat"
                        render={<li />}
                        className={clsx('gap-2 pr-1 pl-3 hover:bg-surface-hover', current === null && 'bg-surface-active')}
                        aria-current={current === null ? 'true' : undefined}
                    >
                        <Icon icon={Folder} size={14} className="shrink-0 text-text-muted" />
                        <button type="button" className="min-w-0 shrink truncate text-left text-sm text-text hover:underline" onClick={onLeave}>
                            {t('worktree.section.projectFolder')}
                        </button>
                        <span className="min-w-0 shrink-[3] truncate text-xs text-text-faint">{t('worktree.section.repositories', { count: repoCount })}</span>
                    </ListRow>
                    {worktrees.map((worktree) => {
                        const working = nodesInWorktree(nodes, worktree);
                        const names = working.map((node) => node.title || node.kind).join(', ');
                        const origin = originLabel(worktree);
                        const nameLine =
                            (worktree.missing ? t('worktree.section.folderMissing') : names === '' ? t('worktree.section.noNode') : names) +
                            (origin === null ? '' : `, ${origin}`);
                        const agentWorking = working.some((node) => nodeWorking(node, sessions, chats, endpointId));
                        const work = worktree.work;
                        const badges = work === undefined ? [] : workBadges(work);
                        const badgeLabel = work === undefined ? '' : workBadgesLabel(worktree, work);
                        const reveal = working[0]?.id ?? null;
                        return (
                            <ContextMenu.Root key={worktree.path}>
                                <ContextMenu.Trigger
                                    render={<ListRow variant="flat" render={<li />} />}
                                    className={clsx('group gap-2 pr-1 pl-3 hover:bg-surface-hover', worktree.path === current && 'bg-surface-active')}
                                    aria-current={worktree.path === current ? 'true' : undefined}
                                >
                                    <Icon icon={worktree.missing ? FolderX : GitBranch} size={14} className="shrink-0 text-text-muted" />
                                    <Tooltip label={worktree.path}>
                                        <button
                                            className="min-w-0 shrink truncate text-left font-mono text-sm text-text hover:underline disabled:no-underline"
                                            disabled={worktree.missing === true}
                                            onClick={() => onView(worktree)}
                                        >
                                            {worktree.branch}
                                        </button>
                                    </Tooltip>
                                    {worktree.locked === true && (
                                        <Tooltip label={t('worktree.section.locked')}>
                                            <span className="shrink-0">
                                                <Icon icon={Lock} size={12} className="text-text-muted" />
                                            </span>
                                        </Tooltip>
                                    )}
                                    {agentWorking && <StatusDot status="running" />}
                                    {/* Gives way three times as fast as the branch: two worktrees are told
                                    apart by their branch, and half a branch name tells them apart no more. */}
                                    <Tooltip
                                        label={
                                            <>
                                                {nameLine}
                                                {(work !== undefined || agentWorking) && (
                                                    <>
                                                        <br />
                                                        {removeVerdict(worktree, agentWorking).reason}
                                                    </>
                                                )}
                                            </>
                                        }
                                    >
                                        <span className="min-w-0 shrink-[3] truncate text-xs text-text-faint">{nameLine}</span>
                                    </Tooltip>
                                    <span className="grow" />
                                    {badges.length > 0 && (
                                        <Tooltip label={badgeLabel}>
                                            {/* One picture with a text alternative: the marks and figures
                                            are read out as the sentence the tooltip shows. */}
                                            <span
                                                role="img"
                                                aria-label={badgeLabel}
                                                className="flex shrink-0 items-center gap-2 text-xs text-text-muted tabular-nums"
                                            >
                                                {badges.map((badge) => (
                                                    <span
                                                        key={badge.kind}
                                                        className={clsx('flex items-center gap-1', badge.kind === 'operation' && 'text-status-needs-you')}
                                                    >
                                                        <Icon icon={BADGE_MARKS[badge.kind]} size={12} />
                                                        {badge.text}
                                                    </span>
                                                ))}
                                            </span>
                                        </Tooltip>
                                    )}
                                    <Menu.Root>
                                        <IconButton
                                            icon={MoreHorizontal}
                                            size="sm"
                                            label={t('worktree.section.actions')}
                                            render={<Menu.Trigger />}
                                            disabled={busy}
                                        />
                                        <Menu.Popup align="end">
                                            <WorktreeMenuItems
                                                worktree={worktree}
                                                reveal={reveal}
                                                onView={onView}
                                                onMerge={onMerge}
                                                onRemove={onRemove}
                                                onReveal={onReveal}
                                                onInspect={() => inspect(worktree, agentWorking)}
                                            />
                                        </Menu.Popup>
                                    </Menu.Root>
                                </ContextMenu.Trigger>
                                <ContextMenu.Popup>
                                    <WorktreeMenuItems
                                        worktree={worktree}
                                        reveal={reveal}
                                        onView={onView}
                                        onMerge={onMerge}
                                        onRemove={onRemove}
                                        onReveal={onReveal}
                                        onInspect={() => inspect(worktree, agentWorking)}
                                    />
                                </ContextMenu.Popup>
                            </ContextMenu.Root>
                        );
                    })}
                </ul>
            )}
            <Dialog.Root open={inspected !== null} onOpenChange={(open) => !open && closeInspection()}>
                <Dialog.Popup size="sm">
                    <Dialog.Title className="font-mono break-all">{inspected?.worktree.branch}</Dialog.Title>
                    {inspected?.verdict == null ? (
                        <Dialog.Text className="mt-1 flex items-center gap-2" role="status">
                            <Spinner size={14} /> {t('worktree.verdict.inspecting')}
                        </Dialog.Text>
                    ) : (
                        <Dialog.Text className="mt-1">{inspected.verdict.reason}</Dialog.Text>
                    )}
                    <Dialog.Footer>
                        <Button onClick={closeInspection}>{t('common:action.close')}</Button>
                        {inspected?.verdict?.removable === true && (
                            <Button
                                variant="danger-outline"
                                onClick={() => {
                                    const target = inspected.worktree;
                                    closeInspection();
                                    onRemove(target);
                                }}
                            >
                                {t('worktree.section.remove')}
                            </Button>
                        )}
                    </Dialog.Footer>
                </Dialog.Popup>
            </Dialog.Root>
        </section>
    );
}

interface WorktreeMenuProps extends Pick<WorktreeSectionProps, 'onView' | 'onMerge' | 'onRemove' | 'onReveal'> {
    worktree: Worktree;
    /* The node working in this worktree, which is what "show on canvas" points at. */
    reveal: string | null;
    onInspect(): void;
}

/*
 * What a worktree row can be asked. The overflow button and the right click on the row offer the
 * same list in the same order; `ContextMenu` draws a `Menu.Item` as its own.
 */
function WorktreeMenuItems({ worktree, reveal, onView, onMerge, onRemove, onReveal, onInspect }: WorktreeMenuProps) {
    const { t } = useTranslation('panels');
    const onCanvas = useDocument(hasActiveCanvas);
    const offerReveal = reveal !== null && onCanvas;
    return (
        <>
            {!worktree.missing && (
                <>
                    <Menu.Item onClick={() => onView(worktree)}>
                        <Icon icon={Eye} size={14} /> {t('worktree.section.view')}
                    </Menu.Item>
                    <Menu.Item onClick={() => onMerge(worktree)}>
                        <Icon icon={GitMerge} size={14} /> {t('worktree.section.merge')}
                    </Menu.Item>
                </>
            )}
            {offerReveal && (
                <Menu.Item onClick={() => onReveal(reveal)}>
                    <Icon icon={LocateFixed} size={14} /> {t('file.menu.showOnCanvas')}
                </Menu.Item>
            )}
            <Menu.Item onClick={onInspect}>
                <Icon icon={ScanSearch} size={14} /> {t('worktree.section.inspect')}
            </Menu.Item>
            <Menu.Separator />
            <Menu.Item className="text-status-error" onClick={() => onRemove(worktree)}>
                <Icon icon={Trash} size={14} /> {t('worktree.section.remove')}
            </Menu.Item>
        </>
    );
}
