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

export const useSidebarProjects = create<{
    order: string[];
    collapsed: string[];
    expandedViews: Record<string, string[]>;
    collapse(key: string, collapsed: boolean): void;
    expandView(key: string, viewId: string, expanded: boolean): void;
    /* Folds the projects the way another window left them. */
    reload(): void;
}>((set) => ({
    order: [],
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
    reload() {
        set({ collapsed: readCollapsed() });
    }
}));

// Loaded with the sidebar, which only a workspace draws, so the start screen does not listen for it.
followOtherWindows(SIDEBAR_PROJECTS_STORAGE_KEY, () => useSidebarProjects.getState().reload());

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
