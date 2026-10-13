import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { openProjectAction } from '@/actions/client-actions';
import { MachineGlyph } from '@/endpoint/MachineGlyph';
import { ProjectGlyph } from '@/project/ProjectGlyph';
import { desktop } from '@/desktop/bridge';
import { reorderWindowTab, setStripIndexAt, useWindowTabs } from '@/project/window-tabs';
import {
    canDragTabs,
    canOpenWindows,
    endTabDrag,
    openInNewWindow,
    outsideViewport,
    startWindowDrag,
    tearOffTab,
    tearOutTab,
    wantsNewWindow
} from '@/project/windows';
import { ProjectAddMenu } from '@/shell/ProjectMenu';
import { useProjectMenu } from '@/shell/project-menu-model';
import { LOCAL_ENDPOINT_ID, useEndpoints } from '@/state/endpoints';
import { splitKey } from '@/state/keys';
import { useProject } from '@/state/project';
import { useProjectList, type ProjectRow } from '@/state/project-list';
import { useServers } from '@/state/server';
import { ContextMenu, Tabs, Tooltip } from '@adecore/ui';

/* How far a pressed tab moves before it is a drag rather than a click. */
const DRAG_THRESHOLD_PX = 4;

/* How far above or below the strip a dragged tab goes before it tears off into a window of its own. */
const TEAR_DISTANCE_PX = 24;

/* A pressed tab: still a click, moving along the strip, out of the window, or moving the window itself. */
interface Press {
    key: string;
    pointerId: number;
    /* Where in the window the press began, which is where the pointer holds a window it tears off into. */
    grab: { x: number; y: number };
    mode: 'press' | 'reorder' | 'out' | 'window';
}

/* The tab under a right-click, read off the element the press landed in. */
function tabKeyOf(event: MouseEvent<HTMLElement>): string | null {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-tab-key]') : null;
    return target?.dataset.tabKey ?? null;
}

/* The place among the other tabs of the strip where a dragged tab lands: before the first one whose middle is right of the pointer. */
function dropIndex(strip: Element, key: string, x: number): number {
    const others = [...strip.querySelectorAll<HTMLElement>('[data-tab-key]')].filter((tab) => tab.dataset.tabKey !== key);
    return others.filter((tab) => {
        const box = tab.getBoundingClientRect();
        return box.left + box.width / 2 < x;
    }).length;
}

/*
 * The projects this window keeps, in place of the switcher, with the switcher itself behind the plus.
 * A tab whose row the list does not have yet waits for it, since a tab without a name says nothing.
 */
export function ProjectTabs({ dirty }: { readonly dirty: boolean }) {
    const model = useProjectMenu();
    const tabs = useWindowTabs((s) => s.tabs);
    const rows = useProjectList((s) => s.projects);
    const current = useProject((s) => s.current);
    const endpoints = useEndpoints((s) => s.endpoints);
    const servers = useServers((s) => s.byEndpoint);
    const [menuKey, setMenuKey] = useState<string | null>(null);
    const press = useRef<Press | null>(null);
    const strip = useRef<HTMLDivElement>(null);
    const windows = canOpenWindows();
    const follows = canDragTabs();

    // The shell learns where the strip is, so a tab dragged out of another window can drop into it.
    useEffect(() => {
        const element = strip.current;
        const shell = desktop();
        if (element === null) {
            return;
        }
        setStripIndexAt((key, x) => dropIndex(element, key, x));
        const report = (): void => {
            const box = element.getBoundingClientRect();
            shell?.setTabStrip?.({ x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) });
        };
        report();
        const observer = new ResizeObserver(report);
        observer.observe(element);
        observer.observe(document.documentElement);
        return () => {
            observer.disconnect();
            setStripIndexAt(null);
            shell?.setTabStrip?.(null);
        };
    }, []);

    const byKey = useMemo(() => {
        const found = new Map<string, ProjectRow>();
        for (const row of rows) {
            found.set(`${row.endpointId}:${row.summary.projectId}`, row);
        }
        return found;
    }, [rows]);
    const shown = tabs.keys.filter((key) => byKey.has(key));
    const menuRow = menuKey === null ? null : (byKey.get(menuKey) ?? null);

    const select = (key: string): void => {
        const { endpointId, id } = splitKey(key);
        openProjectAction(endpointId, id);
    };

    const close = (row: ProjectRow): void => {
        void model.askClose({ endpointId: row.endpointId, machineLabel: '', connected: true, summary: row.summary });
    };

    const onPointerDown = (event: PointerEvent<HTMLElement>, key: string): void => {
        // The close button is a press of its own.
        if (event.button !== 0 || (event.target as Element).closest('button') !== null) {
            return;
        }
        // Held, the pointer keeps reporting to this tab outside the window too, which is where a tab tears off.
        event.currentTarget.setPointerCapture(event.pointerId);
        press.current = { key, pointerId: event.pointerId, grab: { x: event.clientX, y: event.clientY }, mode: 'press' };
    };

    /*
     * Out of the window the tab leaves this strip, and the element that held the press goes with it,
     * so the release is heard on the window itself, which keeps the pointer for as long as it is down.
     */
    const awaitRelease = (held: Press): void => {
        const release = (): void => {
            removeEventListener('pointerup', release);
            removeEventListener('mouseup', release);
            removeEventListener('pointercancel', release);
            if (press.current === held) {
                press.current = null;
            }
            void endTabDrag(held.key, held.mode === 'window');
        };
        addEventListener('pointerup', release);
        addEventListener('mouseup', release);
        addEventListener('pointercancel', release);
    };

    const onPointerMove = (event: PointerEvent<HTMLElement>): void => {
        const held = press.current;
        if (held === null || held.pointerId !== event.pointerId) {
            return;
        }
        if (held.mode === 'press') {
            if (Math.hypot(event.clientX - held.grab.x, event.clientY - held.grab.y) < DRAG_THRESHOLD_PX) {
                return;
            }
            if (shown.length === 1 && follows) {
                held.mode = 'window';
                awaitRelease(held);
                void startWindowDrag(held.key, held.grab);
                return;
            }
            held.mode = 'reorder';
        }
        if (held.mode !== 'reorder') {
            return;
        }
        const box = strip.current?.getBoundingClientRect();
        const offStrip = box !== undefined && (event.clientY < box.top - TEAR_DISTANCE_PX || event.clientY > box.bottom + TEAR_DISTANCE_PX);
        if (follows && (offStrip || outsideViewport(event.clientX, event.clientY))) {
            held.mode = 'out';
            awaitRelease(held);
            // Held by the middle of its tab, at the start of a strip like this one, until the new window says where its strip is.
            const tab = event.currentTarget.getBoundingClientRect();
            const left = box?.left ?? tab.left;
            void tearOutTab(held.key, { x: left + tab.width / 2, y: tab.top + tab.height / 2 }, tab.width);
            return;
        }
        const row = event.currentTarget.parentElement;
        if (row !== null) {
            reorderWindowTab(held.key, dropIndex(row, held.key, event.clientX));
        }
    };

    const onPointerEnd = (event: PointerEvent<HTMLElement>): void => {
        const held = press.current;
        if (held === null || held.pointerId !== event.pointerId) {
            return;
        }
        if (held.mode === 'out' || held.mode === 'window') {
            return;
        }
        press.current = null;
        if (held.mode === 'reorder' && !follows && windows && outsideViewport(event.clientX, event.clientY)) {
            void tearOffTab(held.key, { x: event.screenX - held.grab.x, y: event.screenY - held.grab.y });
        }
    };

    // Moving a tab along the strip moves its element, which lets go of the capture; it is taken back.
    const onLostCapture = (event: PointerEvent<HTMLElement>): void => {
        const held = press.current;
        if (held === null || held.pointerId !== event.pointerId) {
            return;
        }
        if (held.mode === 'press' || held.mode === 'reorder') {
            try {
                event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
                press.current = null;
            }
        }
    };

    return (
        <>
            <Tabs.Root ref={strip} value={tabs.active ?? ''} onValueChange={(value) => select(String(value))} className="flex min-w-0 grow">
                <ContextMenu.Root>
                    <ContextMenu.Trigger
                        className="contents"
                        onContextMenu={(event) => {
                            const key = tabKeyOf(event);
                            if (key === null) {
                                event.preventBaseUIHandler();
                                return;
                            }
                            setMenuKey(key);
                        }}
                    >
                        <Tabs.List variant="pill" overflow="scroll" className="min-w-0 grow" after={<ProjectAddMenu model={model} />}>
                            {shown.map((key) => {
                                const row = byKey.get(key)!;
                                const active = key === tabs.active;
                                const summary = active && current?.projectId === row.summary.projectId ? current : row.summary;
                                const machine = row.endpointId === LOCAL_ENDPOINT_ID ? null : endpoints.find((endpoint) => endpoint.id === row.endpointId);
                                return (
                                    <Tabs.Tab
                                        key={key}
                                        value={key}
                                        data-tab-key={key}
                                        className="app-no-drag"
                                        onClick={(event) => {
                                            if (wantsNewWindow(event)) {
                                                event.preventBaseUIHandler();
                                                openInNewWindow(row.endpointId, row.summary.projectId);
                                            }
                                        }}
                                        onClose={() => close(row)}
                                        onPointerDown={(event) => onPointerDown(event, key)}
                                        onPointerMove={onPointerMove}
                                        onPointerUp={onPointerEnd}
                                        onPointerCancel={onPointerEnd}
                                        onLostPointerCapture={onLostCapture}
                                    >
                                        <ProjectGlyph projectId={summary.projectId} endpointId={row.endpointId} icon={summary.icon} color={summary.color} />
                                        <span className="max-w-40 truncate">{summary.name}</span>
                                        {machine && (
                                            <Tooltip label={machine.label}>
                                                <span className="flex items-center text-text-faint">
                                                    <MachineGlyph icon={servers[row.endpointId]?.icon ?? null} size={14} />
                                                </span>
                                            </Tooltip>
                                        )}
                                        {active && dirty && <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-text-faint" />}
                                    </Tabs.Tab>
                                );
                            })}
                        </Tabs.List>
                    </ContextMenu.Trigger>
                    <ContextMenu.Popup className="min-w-52">{menuRow && model.actionsOf({ ...menuRow, machineLabel: '', connected: true })}</ContextMenu.Popup>
                </ContextMenu.Root>
            </Tabs.Root>
            {model.dialogs}
        </>
    );
}
