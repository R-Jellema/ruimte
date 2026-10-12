const STORAGE_KEY = 'ruimte.language.panel-height';

type PanelHeightStorage = Pick<Storage, 'getItem' | 'setItem'>;

function browserStorage(): PanelHeightStorage | null {
    return typeof localStorage === 'undefined' ? null : localStorage;
}

/* The body height of a peek or call hierarchy panel this client last had, or undefined for the editor's own default. */
export function readPanelHeight(storage: PanelHeightStorage | null = browserStorage()): number | undefined {
    try {
        const height = Number(storage?.getItem(STORAGE_KEY));
        return Number.isFinite(height) && height > 0 ? Math.round(height) : undefined;
    } catch {
        return undefined;
    }
}

export function writePanelHeight(height: number, storage: PanelHeightStorage | null = browserStorage()): void {
    try {
        storage?.setItem(STORAGE_KEY, String(Math.round(height)));
    } catch {
        // Storage that refuses only costs the height at the next start.
    }
}
