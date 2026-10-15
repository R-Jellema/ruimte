import { create } from 'zustand';

/*
 * What a machine said to the copy of this project's nodes that it cannot be told otherwise: it no
 * longer links the project. The node shows it in place of its body, until the machine takes a copy again.
 */
export const useRemoteRefusals = create<{ unlinked: Readonly<Record<string, true>> }>(() => ({ unlinked: {} }));

export function markUnlinked(machineId: string, unlinked: boolean): void {
    useRemoteRefusals.setState((state) => {
        if ((state.unlinked[machineId] === true) === unlinked) {
            return state;
        }
        const next = { ...state.unlinked };
        if (unlinked) {
            next[machineId] = true;
        } else {
            delete next[machineId];
        }
        return { unlinked: next };
    });
}
