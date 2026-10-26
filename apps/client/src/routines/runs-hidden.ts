import { z } from 'zod';
import { create } from 'zustand';
import { storedJson } from '@/state/stored-json';

/*
 * Whether a routine node shows only its Output beside it, without its runs: this client's, per view
 * and node, like the sizes of the cards, and never in the project. Held here as well, so the node's
 * menu and the cards beside it follow one switch.
 */
const useRunsHiddenStore = create<{ byKey: Readonly<Record<string, boolean>> }>(() => ({ byKey: {} }));

function keyOf(viewId: string, nodeId: string): string {
    return `${viewId}.${nodeId}`;
}

function stored(viewId: string, nodeId: string) {
    return storedJson<boolean>(`ruimte.routineRunsHidden.${keyOf(viewId, nodeId)}`, z.boolean());
}

export function useRunsHidden(viewId: string | null, nodeId: string): boolean {
    const held = useRunsHiddenStore((s) => (viewId === null ? undefined : s.byKey[keyOf(viewId, nodeId)]));
    if (viewId === null) {
        return false;
    }
    return held ?? stored(viewId, nodeId).read() ?? false;
}

export function setRunsHidden(viewId: string, nodeId: string, hidden: boolean): void {
    if (hidden) {
        stored(viewId, nodeId).write(true);
    } else {
        stored(viewId, nodeId).remove();
    }
    useRunsHiddenStore.setState((s) => ({ byKey: { ...s.byKey, [keyOf(viewId, nodeId)]: hidden } }));
}
