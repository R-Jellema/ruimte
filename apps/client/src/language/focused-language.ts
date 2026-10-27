import { createFocusRegistry } from '@/shell/panels/focus-registry';
import { cellElement } from '@/shell/cell-rects';
import { useDocument } from '@/state/document';
import type { EditorLanguage } from './ruimte-editor-language';

const languages = createFocusRegistry<EditorLanguage>();

/* An editor's language side and the element it draws in, so a command from the palette or the menu finds the editor that has the keyboard. */
export const registerFocusedLanguage = languages.register;

/* Same lookup as `editorForCommand`, for the language side of the editor. */
export function languageForCommand(): EditorLanguage | null {
    const focused = languages.focused();

    if (focused !== null) {
        return focused;
    }

    const state = useDocument.getState();
    const language = state.activeViewId === null ? null : languages.recentIn(cellElement(state.activeViewId));
    language?.editor.focus();

    return language;
}
