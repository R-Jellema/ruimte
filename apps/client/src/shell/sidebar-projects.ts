import { useEffect, useState } from 'react';
import { create, createStore, useStore, type StoreApi } from 'zustand';
import { z } from 'zod';
import { useEndpoints, type Endpoint } from '@/state/endpoints';
import { listedEndpoints } from '@/state/local-machine';
import { followOtherWindows } from '@/state/other-windows';
import { storedJson } from '@/state/stored-json';
import { machineTransport, pool } from '@/transport';
import { SidebarWatch, type SidebarMachineSnapshot } from './sidebar-watch';

export function sidebarProjectKey(endpointId: string, projectId: string): string {
    return JSON.stringify([endpointId, projectId]);
}

export const SIDEBAR_PROJECTS_STORAGE_KEY = 'ruimte.sidebar.projects';
const storedCollapsed = storedJson(
    SIDEBAR_PROJECTS_STORAGE_KEY,
    z.array(z.unknown()).transform((items) => items.filter((item): item is string => typeof item === 'string'))
);

function readCollapsed(): string[] {
    return storedCollapsed.read() ?? [];
}

/*
 * The order of the projects in "All open projects", per client like which ones are folded. A project
 * that closes keeps its key here, so it comes back in its old place when it opens again.
 */
export const SIDEBAR_ORDER_STORAGE_KEY = 'ruimte.sidebar.order';
const storedOrder = storedJson(
    SIDEBAR_ORDER_STORAGE_KEY,
    z.array(z.unknown()).transform((items) => items.filter((item): item is string => typeof item === 'string'))
);

function readOrder(): string[] {
    return storedOrder.read() ?? [];
}

/*
 * `stored` with `key` moved to `index` among the keys on screen (`visible`, in the order they show). The
 * keys of projects not on screen keep their place among the rest, so each comes back where it was.
 */
export function moveInOrder(stored: readonly string[], visible: readonly string[], key: string, index: number): string[] {
    const others = visible.filter((one) => one !== key);
    const to = Math.max(0, Math.min(index, others.length));
    const rest = stored.filter((one) => one !== key);
    if (others.length === 0) {
        return [key, ...rest];
    }
    if (to < others.length) {
        const before = rest.indexOf(others[to]!);
        return before === -1 ? [...rest, key] : [...rest.slice(0, before), key, ...rest.slice(before)];
    }
    const after = rest.indexOf(others[others.length - 1]!);
    return after === -1 ? [...rest, key] : [...rest.slice(0, after + 1), key, ...rest.slice(after + 1)];
}

export const useSidebarProjects = create<{
    order: string[];
    collapsed: string[];
    expandedViews: Record<string, string[]>;
    collapse(key: string, collapsed: boolean): void;
    expandView(key: string, viewId: string, expanded: boolean): void;
    setOrder(order: string[]): void;
    /* Moves a project to `index` among the projects on screen, which `visible` names in their order. */
    move(visible: readonly string[], key: string, index: number): void;
    /* Folds and orders the projects the way another window left them. */
    reload(): void;
}>((set, get) => ({
    order: readOrder(),
    collapsed: readCollapsed(),
    expandedViews: {},
    collapse(key, collapsed) {
        set((state) => {
            const next = collapsed ? [...new Set([...state.collapsed, key])] : state.collapsed.filter((id) => id !== key);
            storedCollapsed.write(next);
            return { collapsed: next };
        });
    },
    expandView(key, viewId, expanded) {
        set((state) => {
            const before = state.expandedViews[key] ?? [];
            return { expandedViews: { ...state.expandedViews, [key]: expanded ? [...new Set([...before, viewId])] : before.filter((id) => id !== viewId) } };
        });
    },
    setOrder(order) {
        storedOrder.write(order);
        set({ order });
    },
    move(visible, key, index) {
        get().setOrder(moveInOrder(get().order, visible, key, index));
    },
    reload() {
        set({ collapsed: readCollapsed(), order: readOrder() });
    }
}));

// Loaded with the sidebar, which only a workspace draws, so the start screen does not listen for it.
followOtherWindows(SIDEBAR_PROJECTS_STORAGE_KEY, () => useSidebarProjects.getState().reload());
followOtherWindows(SIDEBAR_ORDER_STORAGE_KEY, () => useSidebarProjects.getState().reload());

export function useSidebarMachines(enabled: boolean, endpointIds: readonly string[]): Record<string, SidebarMachineSnapshot> {
    const ids = [...endpointIds].sort().join('\0');
    const [store] = useState(() => createStore<{ snapshots: Record<string, SidebarMachineSnapshot> }>(() => ({ snapshots: {} })));
    // Kept per machine across changes of the set, so a machine joining the sidebar does not make every other one ask again.
    const [watched] = useState(() => new Map<string, () => void>());
    const snapshots = useStore(store, (state) => state.snapshots);
    useEffect(() => {
        if (!enabled) {
            return;
        }
        return () => {
            watched.forEach((stop) => stop());
            watched.clear();
            store.setState({ snapshots: {} });
        };
    }, [enabled, store, watched]);
    useEffect(() => {
        if (!enabled) {
            return;
        }
        const wanted = new Set(ids.split('\0'));
        for (const [endpointId, stop] of [...watched]) {
            if (!wanted.has(endpointId)) {
                stop();
                watched.delete(endpointId);
                store.setState((before) => ({ snapshots: Object.fromEntries(Object.entries(before.snapshots).filter(([id]) => id !== endpointId)) }));
            }
        }
        for (const endpoint of listedEndpoints(useEndpoints.getState().endpoints)) {
            if (wanted.has(endpoint.id) && !watched.has(endpoint.id)) {
                watched.set(endpoint.id, watchMachine(endpoint, store));
            }
        }
    }, [enabled, ids, store, watched]);
    return snapshots;
}

/* One machine's sidebar rows into the store, holding its link until the returned function lets go. */
function watchMachine(endpoint: Endpoint, store: StoreApi<{ snapshots: Record<string, SidebarMachineSnapshot> }>): () => void {
    const watcher = new SidebarWatch(machineTransport(endpoint.id));
    const show = (): void => store.setState((before) => ({ snapshots: { ...before.snapshots, [endpoint.id]: watcher.getSnapshot() } }));
    const off = watcher.subscribe(show);
    show();
    const release = pool.hold(endpoint);
    return () => {
        off();
        watcher.dispose();
        release();
    };
}
