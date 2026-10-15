import { create } from 'zustand';

/*
 * The machines whose peer link this window could not renew, so agents there cannot give tasks yet. The
 * nodes of such a machine keep working: they run on the window's own connection, not on the link.
 */
export const usePeerLapse = create<{ lapsed: Readonly<Record<string, true>> }>(() => ({ lapsed: {} }));

export function markPeerLapsed(machineId: string, lapsed: boolean): void {
    usePeerLapse.setState((state) => {
        if ((state.lapsed[machineId] === true) === lapsed) {
            return state;
        }
        const next = { ...state.lapsed };
        if (lapsed) {
            next[machineId] = true;
        } else {
            delete next[machineId];
        }
        return { lapsed: next };
    });
}
