import { create } from 'zustand';

const STORAGE_KEY = 'ruimte.patch-view';

export type PatchViewMode = 'patch' | 'text';

export function readMode(): PatchViewMode {
    try {
        return localStorage.getItem(STORAGE_KEY) === 'text' ? 'text' : 'patch';
    } catch {
        return 'patch';
    }
}

interface PatchViewStore {
    mode: PatchViewMode;
    setMode(mode: PatchViewMode): void;
}

/* How `.patch` and `.diff` files open on this client: as a patch, or as the plain text. Never part of a project. */
export const usePatchView = create<PatchViewStore>((set) => ({
    mode: readMode(),
    setMode(mode) {
        try {
            localStorage.setItem(STORAGE_KEY, mode);
        } catch {
            // Storage that refuses keeps the choice for this session only.
        }
        set({ mode });
    }
}));
