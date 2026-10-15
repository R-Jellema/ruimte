import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ChevronsDownUp,
    ChevronsUpDown,
    CircleStop,
    Copy,
    Eraser,
    EyeOff,
    Expand,
    ExternalLink,
    Frame,
    GitBranch,
    GitMerge,
    Group,
    LayoutGrid,
    Link2,
    Maximize2,
    MessageSquare,
    MessagesSquare,
    Move,
    Palette,
    Pencil,
    Scaling,
    Shrink,
    Sparkles,
    Terminal,
    Trash
} from 'lucide-react';
import type { ProviderInfo, Task } from '@ruimte/contracts';
import {
    arrangeGroupAction,
    clearTerminalAction,
    colorNoteAction,
    createNodeAction,
    duplicateNodeAction,
    focusNodeAction,
    ignoreRefusal,
    linkNodesAction,
    perform
} from '@/actions/client-actions';
import { BringBackItem } from '@/canvas/BringBackItem';
import { ChatAgentSubmenu } from '@/agents/AgentMenus';
import { askBeforeClearingChat, askBeforeStoppingTask } from '@/agents/end-children';
import { FlagSubmenu } from '@/project/FlagSubmenu';
import { askOpenAsView, canOpenAsView } from '@/project/views';
import { accentLabel, NODE_ACCENTS } from '@/canvas/accents';
import { DEFAULT_NOTE_COLOR, NOTE_COLORS } from '@/canvas/note-colors';
import { EMPTY_DRAFT, writeDraft } from '@adecore/agents-react/chat';
import { BookmarkSubmenu } from '@adecore/agents-react/chat/ui';
import { ForkMenuItem } from '@/chat/ForkMenuItem';
import { useOffersFork } from '@/chat/use-offers-fork';
import { stopPrWatch } from '@/shell/pr-watch-actions';
import { useUnstartedTask } from '@/canvas/remote-wait';
import { useEndpointId } from '@/state/keys';
import { useChatPrWatch } from '@/state/pr-watches';
import { FileActionItems } from '@/shell/panels/FileActionItems';
import { resolveStoredPath } from '@/shell/panels/files-tree';
import { worktreeDiffTab } from '@/shell/panels/worktree-rows';
import { deleteSelectionAsking } from '@/canvas/delete-selection';
import { maximizedNodeOf, useCanvas, useCanvasStore } from '@/state/canvas';
import { useChatRow, useProviders } from '@adecore/agents-react/state';
import { useFiles } from '@/state/files';
import { isScratchProject, useProject } from '@/state/project';
import { fileManagerName, useServer } from '@/state/server';
import { useSessionRow } from '@/state/sessions';
import { useSettings } from '@/state/settings';
import { useUi } from '@/state/ui';
import { useGroupWorktrees, useWorktreeOf } from '@/state/worktrees';
import { useToasts } from '@/state/toasts';
import { useWorkspace } from '@/transport/connections';
import { NodeMachineScope } from '@/transport/node-machine';
import { useTransport } from '@/transport/context';
import { DisabledReason, Icon, Kbd, ContextMenu } from '@adecore/ui';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { formatNodeSize, makeDefaultSize } from '@/canvas/default-size';

/*
 * The context menu of one node, the same from its frame and from its row in the sidebar. `snooze`
 * leads it, and is all a row offers for a node that is not on the canvas this menu acts on.
 */
export function NodeMenuPopup(props: { id: string; onRename(): void; snooze?: ReactNode }) {
    const machine = useCanvas((s) => s.nodes[props.id]?.machine);
    return (
        <NodeMachineScope machine={machine}>
            <NodeMenuContent {...props} />
        </NodeMachineScope>
    );
}

function NodeMenuContent({ id, onRename, snooze }: { id: string; onRename(): void; snooze?: ReactNode }) {
    const { t } = useTranslation('canvas');
    const canvasStore = useCanvasStore();
    const node = useCanvas((s) => s.nodes[id]);
    const endpointId = useEndpointId();
    const prWatch = useChatPrWatch(id);
    const waitingTask = useUnstartedTask(id, node?.machine);
    const maximized = useCanvas((s) => maximizedNodeOf(s) === id);
    const moveLocked = useCanvas((s) => s.locks.move);
    const agent = useSessionRow(id, (row) => row?.agent);
    const sessionAccount = useSessionRow(id, (row) => row?.account);
    const chatSession = useChatRow(id, (row) => row?.info.agentSessionId);
    const offersFork = useOffersFork(id);
    const bookmarked = useChatRow(id, (row) => (row?.bookmarks?.length ?? 0) > 0);
    const chatCwd = useChatRow(id, (row) => row?.info.cwd);
    const chatProvider = useChatRow(id, (row) => row?.info.provider);
    const chatAccount = useChatRow(id, (row) => row?.info.account);
    const platform = useServer((s) => s.platform);
    const providers = useProviders((s) => s.providers);
    const projectFolder = useProject((s) => s.current?.folder ?? null);
    const scratch = useProject((s) => isScratchProject(s.current));
    // The machine of the node: the agents a clear would end are its.
    const transport = useTransport();
    // The project's worktrees, which a delete asks about, are the workspace's.
    const workspaceTransport = useWorkspace()?.connection.transport ?? transport;
    const nodeWorktree = useWorktreeOf(node?.kind === 'terminal' || node?.kind === 'chat' ? node.cwd : undefined);
    const groupWorktrees = useGroupWorktrees(node?.kind === 'group' ? id : null);

    if (!node) {
        return snooze ? <ContextMenu.Popup>{snooze}</ContextMenu.Popup> : null;
    }

    const remove = (): void => {
        canvasStore.getState().select([id]);
        void deleteSelectionAsking(canvasStore, workspaceTransport);
    };
    if (node.kind === 'unknown') {
        return <UnknownNodeMenuPopup id={id} onDelete={remove} />;
    }
    const kind = node.kind;
    // The same CLI session can continue in the other kind of node, next to this one.
    const beside = { x: node.x + node.w + 40 + 260, y: node.y + node.h / 2 };
    // Any CLI the daemon has a chat backend for can go on in a chat node.
    const canOpenInChat = agent ? providers.some((entry) => entry.kind === agent.kind && entry.capabilities.chat) : false;
    const viewId = canvasStore.getState().viewId;
    const openInChat = (): void => {
        if (agent) {
            // The account travels with the session, since another account's folder does not hold its conversation.
            const account = agent.kind === node.provider ? (sessionAccount ?? node.account) : undefined;
            void createNodeAction('chat', {
                viewId,
                title: node.title,
                cwd: node.cwd,
                resume: agent.agentSessionId,
                provider: agent.kind,
                ...(account === undefined ? {} : { account }),
                at: beside
            });
        }
    };
    // The task was given by a chat of the workspace's machine, which owes the start and is the one that ends it.
    const stopWaiting = (task: Task): void => {
        void askBeforeStoppingTask(workspaceTransport, id, task.title, () => {
            void perform('chat.stopSubagent', { chatId: task.parentId, toolUseId: `task-${task.id}` }).catch(ignoreRefusal);
        });
    };
    const clearChat = (): void => {
        void askBeforeClearingChat(transport, id, node.title, () => {
            // The dialog already said that a running turn stops, so the composer's busy-turn question is skipped.
            perform('chat.clear', { chatId: id, force: true }).catch((error: unknown) =>
                useToasts.getState().show({
                    kind: 'error',
                    title: t('menu.clearFailed', { what: node.title }),
                    description: error instanceof Error ? error.message : undefined
                })
            );
        });
    };
    const openInTerminal = (): void => {
        // The daemon owns the resume line: the node only says which CLI and which session.
        if (chatSession && chatProvider) {
            void createNodeAction('terminal', {
                viewId,
                title: node.title,
                cwd: chatCwd,
                provider: chatProvider,
                resume: chatSession,
                ...(chatAccount === undefined ? {} : { account: chatAccount }),
                at: beside
            });
        }
    };
    /*
     * A note becomes the opening prompt of a chat beside it. The prompt is only seeded, never sent:
     * the person reads it once more and presses Enter. The edge keeps the note readable to the agent
     * through `ruimte-context`, so a note edited later still reaches it.
     */
    const startAgentFromNote = async (provider: ProviderInfo): Promise<void> => {
        const chatId = await createNodeAction('chat', { viewId, provider: provider.kind, at: beside });
        if (chatId === null || viewId === null) {
            return;
        }
        const body = node.body?.trim();
        if (body) {
            writeDraft(chatId, { ...EMPTY_DRAFT, text: body });
        }
        await linkNodesAction(viewId, id, chatId);
    };
    // The folder the node works in: its own, or the project's when it has none. The Chats project shows none of its folders.
    const workingFolder = scratch
        ? null
        : node.kind === 'terminal' || node.kind === 'chat'
          ? (node.cwd ?? chatCwd ?? projectFolder)
          : (node.worktree?.path ?? null);
    // What the node holds is stored against the project folder; the menu acts on the daemon's path.
    const filePath = node.kind === 'file' && node.path ? resolveStoredPath(projectFolder, node.path) : null;

    // A collapsed group is only its header, which is no size to start a group at.
    const sizable = !(node.kind === 'group' && node.collapsed);
    const worktreeOf = nodeWorktree && projectFolder !== null ? nodeWorktree : null;
    const groupWorktreePaths = groupWorktrees.length > 0 && projectFolder !== null ? groupWorktrees.map((worktree) => worktree.path) : [];
    const place = canOpenAsView(node.kind) || workingFolder !== null || filePath !== null;
    // A chat that has not run a turn yet has nothing to put under Conversation.
    const conversation = node.kind === 'chat' && (offersFork || bookmarked || Boolean(chatSession) || prWatch !== null);

    return (
        <ContextMenu.Popup>
            {snooze}
            <ContextMenu.Item onClick={onRename}>
                <Icon icon={Pencil} size={14} /> {t('common:action.rename')} <ContextMenu.Hint>{t('menu.doubleClick')}</ContextMenu.Hint>
            </ContextMenu.Item>
            <ContextMenu.Item onClick={() => duplicateNodeAction(canvasStore.getState().viewId, id)}>
                <Icon icon={Copy} size={14} /> {t('menu.duplicate')}
            </ContextMenu.Item>
            <ContextMenu.Item onClick={() => canvasStore.getState().startLink(id)}>
                <Icon icon={Link2} size={14} /> {t('menu.connect')}
                <ContextMenu.Hint>{t('menu.connectHint')}</ContextMenu.Hint>
            </ContextMenu.Item>
            <ContextMenu.Separator />
            {conversation && (
                <ContextMenu.SubmenuRoot>
                    <ContextMenu.SubmenuTrigger>
                        <Icon icon={MessagesSquare} size={14} /> {t('menu.conversation')}
                    </ContextMenu.SubmenuTrigger>
                    <ContextMenu.Popup>
                        <ForkMenuItem chatId={id} />
                        <BookmarkSubmenu chatId={id} />
                        {chatSession && (
                            <ContextMenu.Item onClick={openInTerminal}>
                                <Icon icon={Terminal} size={14} /> {t('menu.openInTerminal')}
                            </ContextMenu.Item>
                        )}
                        {prWatch !== null && (
                            <ContextMenu.Item onClick={() => void stopPrWatch(endpointId, id)}>
                                <Icon icon={EyeOff} size={14} /> {t('menu.stopPrWatch')}
                            </ContextMenu.Item>
                        )}
                    </ContextMenu.Popup>
                </ContextMenu.SubmenuRoot>
            )}
            {node.kind === 'terminal' && (
                <ContextMenu.SubmenuRoot>
                    <ContextMenu.SubmenuTrigger>
                        <Icon icon={Terminal} size={14} /> {t('kinds.terminal')}
                    </ContextMenu.SubmenuTrigger>
                    <ContextMenu.Popup>
                        {canOpenInChat && (
                            <ContextMenu.Item onClick={openInChat}>
                                <Icon icon={MessageSquare} size={14} /> {t('menu.openInChat')}
                            </ContextMenu.Item>
                        )}
                        <ContextMenu.Item onClick={() => clearTerminalAction(id)}>
                            <Icon icon={Eraser} size={14} /> {t('menu.clear')}
                        </ContextMenu.Item>
                    </ContextMenu.Popup>
                </ContextMenu.SubmenuRoot>
            )}
            {node.kind === 'group' && (
                <ContextMenu.SubmenuRoot>
                    <ContextMenu.SubmenuTrigger>
                        <Icon icon={Group} size={14} /> {t('kinds.group')}
                    </ContextMenu.SubmenuTrigger>
                    <ContextMenu.Popup>
                        <ContextMenu.Item onClick={() => canvasStore.getState().toggleGroupCollapse(id)}>
                            {node.collapsed ? <Icon icon={ChevronsUpDown} size={14} /> : <Icon icon={ChevronsDownUp} size={14} />}{' '}
                            {node.collapsed ? t('group.expand') : t('group.collapse')}
                        </ContextMenu.Item>
                        <DisabledReason reason={node.collapsed ? t('group.arrangeCollapsed') : moveLocked ? t('group.arrangeLocked') : null}>
                            <ContextMenu.Item disabled={node.collapsed || moveLocked} onClick={() => arrangeGroupAction(canvasStore.getState().viewId, id)}>
                                <Icon icon={LayoutGrid} size={14} /> {t('group.arrange')}
                            </ContextMenu.Item>
                        </DisabledReason>
                        {node.worktree ? (
                            <ContextMenu.Item onClick={() => canvasStore.getState().setGroupWorktree(id, null)}>
                                <Icon icon={GitBranch} size={14} /> {t('menu.unbindWorktree')}
                                <ContextMenu.Hint>{t('menu.unbindWorktreeHint')}</ContextMenu.Hint>
                            </ContextMenu.Item>
                        ) : (
                            <ContextMenu.Item onClick={() => useUi.getState().setWorktreeDialogFor(id)}>
                                <Icon icon={GitBranch} size={14} /> {t('menu.bindWorktree')}
                            </ContextMenu.Item>
                        )}
                    </ContextMenu.Popup>
                </ContextMenu.SubmenuRoot>
            )}
            {(worktreeOf !== null || groupWorktreePaths.length > 0) && projectFolder !== null && (
                <ContextMenu.SubmenuRoot>
                    <ContextMenu.SubmenuTrigger>
                        <Icon icon={GitBranch} size={14} /> {t('menu.worktree')}
                    </ContextMenu.SubmenuTrigger>
                    <ContextMenu.Popup>
                        {worktreeOf !== null && (
                            <ContextMenu.Item
                                onClick={() => {
                                    // Selecting the node is what points the git panel at the worktree it works in.
                                    canvasStore.getState().select([id]);
                                    useUi.getState().setPanel({ open: true, kind: 'git' });
                                    const tab = worktreeDiffTab(worktreeOf);
                                    useFiles.getState().open(tab.path, useSettings.getState().filesTabLimit, tab.view);
                                }}
                            >
                                <Icon icon={GitBranch} size={14} /> {t('menu.viewWorktree')}
                                <ContextMenu.Hint className="font-mono">{worktreeOf.branch}</ContextMenu.Hint>
                            </ContextMenu.Item>
                        )}
                        <WorktreeItems folder={projectFolder} paths={worktreeOf !== null ? [worktreeOf.path] : groupWorktreePaths} />
                    </ContextMenu.Popup>
                </ContextMenu.SubmenuRoot>
            )}
            <ContextMenu.SubmenuRoot>
                <ContextMenu.SubmenuTrigger>
                    <Icon icon={Move} size={14} /> {t('menu.sizeAndPosition')}
                </ContextMenu.SubmenuTrigger>
                <ContextMenu.Popup>
                    <ContextMenu.Item onClick={() => focusNodeAction(canvasStore.getState().viewId, id)}>
                        <Icon icon={Maximize2} size={14} /> {t('node.zoomTo')}
                    </ContextMenu.Item>
                    {node.kind !== 'group' && (
                        <ContextMenu.Item onClick={() => canvasStore.getState().toggleMaximizedNode(id)}>
                            <Icon icon={maximized ? Shrink : Expand} size={14} /> {t(maximized ? 'node.restore' : 'node.maximize')}{' '}
                            <Kbd shortcut={CANVAS_SHORTCUTS.maximizeCell} />
                        </ContextMenu.Item>
                    )}
                    {sizable && (
                        <ContextMenu.Item onClick={() => void makeDefaultSize(endpointId, kind, { w: node.w, h: node.h })}>
                            <Icon icon={Scaling} size={14} /> {t('menu.makeDefaultSize')}
                            <ContextMenu.Hint>{formatNodeSize(node)}</ContextMenu.Hint>
                        </ContextMenu.Item>
                    )}
                </ContextMenu.Popup>
            </ContextMenu.SubmenuRoot>
            {(node.kind === 'terminal' || node.kind === 'chat') && <BringBackItem node={node} />}
            {waitingTask !== null && (
                <ContextMenu.Item onClick={() => stopWaiting(waitingTask)}>
                    <Icon icon={CircleStop} size={14} /> {t('menu.stopWaiting')}
                </ContextMenu.Item>
            )}
            {node.kind === 'note' && (
                <ChatAgentSubmenu
                    label={t('menu.startAgentFromNote')}
                    icon={<Icon icon={Sparkles} size={14} />}
                    onPick={(provider) => void startAgentFromNote(provider)}
                />
            )}
            <ContextMenu.Separator />
            <FlagSubmenu id={id} />
            <AccentSubmenu id={id} picked={node.accent} />
            {node.kind === 'note' && <NoteColorSubmenu viewId={viewId} id={id} picked={node.color ?? DEFAULT_NOTE_COLOR} />}
            {place && <ContextMenu.Separator />}
            {canOpenAsView(node.kind) && (
                <ContextMenu.Item onClick={() => askOpenAsView(id)}>
                    <Icon icon={Frame} size={14} /> {t('menu.openAsView')}
                    <ContextMenu.Hint>{t('menu.openAsViewHint')}</ContextMenu.Hint>
                </ContextMenu.Item>
            )}
            {workingFolder && (
                <ContextMenu.Item onClick={() => void transport.request('fs.reveal', { path: workingFolder }).catch(() => undefined)}>
                    <Icon icon={ExternalLink} size={14} /> {t('menu.openIn', { app: fileManagerName(platform) })}
                </ContextMenu.Item>
            )}
            {node.kind === 'file' && filePath !== null && <FileActionItems path={filePath} on="node" />}
            <ContextMenu.Separator />
            {node.kind === 'chat' && (
                <ContextMenu.Item onClick={clearChat}>
                    <Icon icon={Eraser} size={14} /> {t('menu.clearAsking')}
                </ContextMenu.Item>
            )}
            <ContextMenu.Item className="text-status-error" onClick={remove}>
                <Icon icon={Trash} size={14} /> {t('common:action.delete')} <Kbd shortcut={CANVAS_SHORTCUTS.deleteSelection} />
            </ContextMenu.Item>
        </ContextMenu.Popup>
    );
}

function WorktreeItems({ folder, paths }: { folder: string; paths: string[] }) {
    const { t } = useTranslation('canvas');
    return (
        <>
            <ContextMenu.Item onClick={() => useUi.getState().setWorktreeMerge({ folder, paths })}>
                <Icon icon={GitMerge} size={14} /> {t('menu.mergeWorktrees', { count: paths.length })}
            </ContextMenu.Item>
            <ContextMenu.Item className="text-status-error" onClick={() => useUi.getState().setWorktreeRemoval({ folder, paths })}>
                <Icon icon={Trash} size={14} /> {t('menu.removeWorktrees', { count: paths.length })}
            </ContextMenu.Item>
        </>
    );
}

function NoteColorSubmenu({ viewId, id, picked }: { viewId: string | null; id: string; picked: string }) {
    const { t } = useTranslation('canvas');
    return (
        <ContextMenu.SubmenuRoot>
            <ContextMenu.SubmenuTrigger>
                <Icon icon={Palette} size={14} /> {t('menu.noteColor')}
            </ContextMenu.SubmenuTrigger>
            <ContextMenu.Popup className="min-w-40">
                {NOTE_COLORS.map((color) => (
                    <ContextMenu.Item key={color.id} onClick={() => colorNoteAction(viewId, id, color.id)}>
                        <ContextMenu.Check kind="radio" checked={picked === color.id} />
                        <span className={`h-3 w-3 rounded-full border border-border-strong ${color.className}`} /> {t(`noteColors.${color.id}`)}
                    </ContextMenu.Item>
                ))}
            </ContextMenu.Popup>
        </ContextMenu.SubmenuRoot>
    );
}

function AccentSubmenu({ id, picked }: { id: string; picked: string | undefined }) {
    const { t } = useTranslation('canvas');
    const canvasStore = useCanvasStore();
    return (
        <ContextMenu.SubmenuRoot>
            <ContextMenu.SubmenuTrigger>
                <Icon icon={Palette} size={14} /> {t('menu.color')}
            </ContextMenu.SubmenuTrigger>
            {/* The same list as Flag; only the colors scroll, so None stays in sight in a short window. */}
            <ContextMenu.Popup className="flex min-w-44 flex-col overflow-hidden">
                <div className="min-h-0 overflow-y-auto overscroll-contain">
                    {NODE_ACCENTS.map((accent) => (
                        <ContextMenu.Item key={accent.id} onClick={() => canvasStore.getState().setNodeAccent(id, accent.id)}>
                            <ContextMenu.Check kind="radio" checked={picked === accent.id} />
                            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: accent.color }} aria-hidden />
                            <span className="grow">{accentLabel(accent.id)}</span>
                        </ContextMenu.Item>
                    ))}
                </div>
                <ContextMenu.Separator />
                <ContextMenu.Item onClick={() => canvasStore.getState().setNodeAccent(id, null)}>
                    <ContextMenu.Check kind="radio" checked={!picked} /> {t('menu.noAccent')}
                </ContextMenu.Item>
            </ContextMenu.Popup>
        </ContextMenu.SubmenuRoot>
    );
}

/* A node of a kind a newer Ruimte made: this version can find it and remove it, and nothing more. */
function UnknownNodeMenuPopup({ id, onDelete }: { id: string; onDelete(): void }) {
    const { t } = useTranslation('canvas');
    const canvasStore = useCanvasStore();
    return (
        <ContextMenu.Popup>
            <ContextMenu.Item onClick={() => focusNodeAction(canvasStore.getState().viewId, id)}>
                <Icon icon={Maximize2} size={14} /> {t('node.zoomTo')}
            </ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Item className="text-status-error" onClick={onDelete}>
                <Icon icon={Trash} size={14} /> {t('common:action.delete')} <Kbd shortcut={CANVAS_SHORTCUTS.deleteSelection} />
            </ContextMenu.Item>
        </ContextMenu.Popup>
    );
}
