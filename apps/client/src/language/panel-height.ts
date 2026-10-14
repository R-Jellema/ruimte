import { storedText } from '@/state/stored-json';

const panelHeight = storedText('ruimte.language.panel-height');

/* The body height of a peek or call hierarchy panel this client last had, or undefined for the editor's own default. */
export function readPanelHeight(storage?: Pick<Storage, 'getItem'> | null): number | undefined {
    const height = Number(panelHeight.read(storage));
    return Number.isFinite(height) && height > 0 ? Math.round(height) : undefined;
}

export function writePanelHeight(height: number, storage?: Pick<Storage, 'setItem'> | null): void {
    panelHeight.write(String(Math.round(height)), storage);
}
