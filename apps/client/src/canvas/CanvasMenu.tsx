import { useTranslation } from 'react-i18next';
import {
    CalendarClock,
    FileText,
    Globe,
    LayoutGrid,
    Maximize,
    MessageSquare,
    Minus,
    Scan,
    SquareDashedMousePointer,
    StickyNote,
    Terminal,
    Type
} from 'lucide-react';
import { createNodeAction, createTextAction, fitAction, groupSelectionAction, selectAllAction } from '@/actions/client-actions';
import { AgentSubmenus } from '@/agents/AgentMenus';
import type { Point } from '@/canvas/math';
import { RemoteMachineItems } from '@/canvas/RemoteMachineItems';
import { openRoutineForm } from '@/routines/form-state';
import { useRoutineList } from '@/routines/routine-list';
import { useMachineAnswers } from '@/transport/features';
import { useCanvas, useCanvasStore } from '@/state/canvas';
import { shownFolderOf, useProject } from '@/state/project';
import { useUi } from '@/state/ui';
import { Icon, Kbd, ContextMenu, Menu } from '@adecore/ui';
import { ADD_NODE_SHORTCUTS, CANVAS_SHORTCUTS } from '@/canvas/shortcuts';

/* Nodes and text land at the right-click; a line starts with the next drag. */
export function CanvasMenuPopup({ at }: { at: () => Point }) {
    const { t } = useTranslation(['canvas', 'drawing']);
    const canvasStore = useCanvasStore();
    const hasSelection = useCanvas((s) => s.selection.length > 0);
    /* A file comes out of the open folder, so a project without one has nothing to pick from. */
    const hasFolder = useProject((s) => shownFolderOf(s.current) !== null);
    // The workspace's machine, not a remote node's: a routine belongs to the project.
    const projectId = useProject((s) => s.current?.projectId ?? null);
    const endpointId = useProject((s) => s.currentEndpointId);
    const routines = useMachineAnswers(endpointId ?? '', 'routine.list');
    const add = (kind: 'terminal' | 'chat' | 'browser' | 'group' | 'note'): void => {
        void createNodeAction(kind, { at: at() });
    };
    return (
        <ContextMenu.Popup>
            <ContextMenu.Group>
                <AgentSubmenus onPick={(target, provider, account) => void createNodeAction(target, { provider: provider.kind, account, at: at() })} />
                <ContextMenu.Item onClick={() => add('terminal')}>
                    <Icon icon={Terminal} size={14} /> {t('kinds.terminal')} <Kbd shortcut={ADD_NODE_SHORTCUTS.terminal} />
                </ContextMenu.Item>
                <ContextMenu.Item onClick={() => add('chat')}>
                    <Icon icon={MessageSquare} size={14} /> {t('kinds.chat')} <Kbd shortcut={ADD_NODE_SHORTCUTS.chat} />
                </ContextMenu.Item>
                <ContextMenu.Item onClick={() => add('browser')}>
                    <Icon icon={Globe} size={14} /> {t('kinds.browser')} <Kbd shortcut={ADD_NODE_SHORTCUTS.browser} />
                </ContextMenu.Item>
                {routines && projectId !== null && endpointId !== null && <RoutineItems endpointId={endpointId} projectId={projectId} at={at} />}
                <ContextMenu.Item onClick={() => add('group')}>
                    <Icon icon={LayoutGrid} size={14} /> {t('kinds.group')} <Kbd shortcut={ADD_NODE_SHORTCUTS.group} />
                </ContextMenu.Item>
                {hasFolder && (
                    <ContextMenu.Item onClick={() => useUi.getState().openFilePicker({ kind: 'node', at: at() })}>
                        <Icon icon={FileText} size={14} /> {t('canvasMenu.file')}
                    </ContextMenu.Item>
                )}
                <RemoteMachineItems at={at} />
            </ContextMenu.Group>
            <ContextMenu.Separator />
            <ContextMenu.Group>
                <ContextMenu.Item onClick={() => add('note')}>
                    <Icon icon={StickyNote} size={14} /> {t('kinds.note')} <Kbd shortcut={ADD_NODE_SHORTCUTS.note} />
                </ContextMenu.Item>
                <ContextMenu.Item onClick={() => canvasStore.getState().setLineTool('line')}>
                    <Icon icon={Minus} size={14} /> {t('drawing:tools.line')}
                </ContextMenu.Item>
                <ContextMenu.Item onClick={() => createTextAction(at())}>
                    <Icon icon={Type} size={14} /> {t('kinds.text')} <ContextMenu.Hint>{t('menu.doubleClick')}</ContextMenu.Hint>
                </ContextMenu.Item>
            </ContextMenu.Group>
            <ContextMenu.Separator />
            <ContextMenu.Group>
                <ContextMenu.Item onClick={() => selectAllAction(canvasStore)}>
                    <Icon icon={Scan} size={14} /> {t('common:action.selectAll')} <Kbd shortcut={CANVAS_SHORTCUTS.selectAll} />
                </ContextMenu.Item>
                <ContextMenu.Item disabled={!hasSelection} onClick={() => groupSelectionAction()}>
                    <Icon icon={SquareDashedMousePointer} size={14} /> {t('canvasMenu.groupSelection')} <Kbd shortcut={CANVAS_SHORTCUTS.group} />
                </ContextMenu.Item>
                <ContextMenu.Item onClick={() => fitAction()}>
                    <Icon icon={Maximize} size={14} /> {t('canvasMenu.zoomToFit')} <Kbd shortcut={CANVAS_SHORTCUTS.fitAll} />
                </ContextMenu.Item>
            </ContextMenu.Group>
        </ContextMenu.Popup>
    );
}

/* A routine of this project placed as a node, or a new one; without any yet, only the new one. */
function RoutineItems({ endpointId, projectId, at }: { endpointId: string; projectId: string; at: () => Point }) {
    const { t } = useTranslation('canvas');
    const list = useRoutineList(endpointId);
    const entries = list?.status === 'ready' ? list.result.routines.filter((entry) => entry.projectId === projectId) : [];
    if (entries.length === 0) {
        return (
            <ContextMenu.Item onClick={() => openRoutineForm({ projectId })}>
                <Icon icon={CalendarClock} size={14} /> {t('canvasMenu.routine')}
            </ContextMenu.Item>
        );
    }
    return (
        <Menu.SubmenuRoot>
            <Menu.SubmenuTrigger>
                <Icon icon={CalendarClock} size={14} /> {t('canvasMenu.routines')}
            </Menu.SubmenuTrigger>
            <Menu.Popup className="max-h-96 min-w-48 overflow-y-auto">
                {entries.map((entry) => (
                    <Menu.Item
                        key={entry.routine.id}
                        onClick={() => void createNodeAction('routine', { routine: entry.routine.id, title: entry.routine.title, at: at() })}
                    >
                        <span className="truncate">{entry.routine.title}</span>
                    </Menu.Item>
                ))}
                <Menu.Separator />
                <Menu.Item onClick={() => openRoutineForm({ projectId })}>{t('canvasMenu.newRoutine')}</Menu.Item>
            </Menu.Popup>
        </Menu.SubmenuRoot>
    );
}
