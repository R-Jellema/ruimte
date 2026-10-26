import { cellElement } from '@/shell/cell-rects';
import { useDocument } from '@/state/document';
import type { EditorLanguage } from './ruimte-editor-language';

interface Entry {
    language: EditorLanguage;
    surface: HTMLElement;
}

const entries = new Set<Entry>();
let recent: Entry | null = null;

/* An editor's language side and the element it draws in, so a command from the palette or the menu finds the editor that has the keyboard. */
export function registerFocusedLanguage(language: EditorLanguage, surface: HTMLElement): () => void {
    const entry = { language, surface };
    const remember = (): void => {
        recent = entry;
    };
    entries.add(entry);
    surface.addEventListener('focusin', remember);
    return () => {
        entries.delete(entry);
        surface.removeEventListener('focusin', remember);
        if (recent === entry) {
            recent = null;
        }
    };
}

/* The language side of the editor the keyboard is in, or null when it is anywhere else. */
function focusedLanguage(): EditorLanguage | null {
    const active = document.activeElement;
    if (active === null) {
        return null;
    }
    let found: Entry | null = null;
    for (const entry of entries) {
        if (entry.surface.contains(active) && (found === null || found.surface.contains(entry.surface))) {
            found = entry;
        }
    }
    return found?.language ?? null;
}

/* The editor that last had the keyboard, when it sits in `cell`; null for a cell that never held one. */
function recentLanguageIn(cell: Element | null): EditorLanguage | null {
    return cell !== null && recent !== null && entries.has(recent) && cell.contains(recent.surface) ? recent.language : null;
}

/*
 * The editor a menu or palette command means: the one with the keyboard, else the one the active view
 * had it last, which then gets the keyboard back, since focus left it for something else in the same view.
 */
export function languageForCommand(): EditorLanguage | null {
    const focused = focusedLanguage();
    if (focused !== null) {
        return focused;
    }
    const state = useDocument.getState();
    const language = state.activeViewId === null ? null : recentLanguageIn(cellElement(state.activeViewId));
    language?.editor.focus();
    return language;
}
