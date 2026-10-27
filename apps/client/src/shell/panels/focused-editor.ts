import type { Editor } from '@adecore/editor';
import { cellElement } from '@/shell/cell-rects';
import { useDocument } from '@/state/document';
import { createFocusRegistry } from './focus-registry';

const editors = createFocusRegistry<Editor>();

/* An editor and the element it draws in, so a command from the palette or the menu finds the editor that has the keyboard. */
export const registerFocusedEditor = editors.register;

export const focusedEditor = editors.focused;

export const recentEditorIn = editors.recentIn;

/*
 * The editor a menu or palette command means: the one with the keyboard, else the one the active view
 * had it last, which then gets the keyboard back, since focus left it for something else in the same view.
 */
export function editorForCommand(): Editor | null {
    const focused = focusedEditor();

    if (focused !== null) {
        return focused;
    }

    const state = useDocument.getState();
    const editor = state.activeViewId === null ? null : recentEditorIn(cellElement(state.activeViewId));
    editor?.focus();

    return editor;
}

/* The active view's last focused editor, when `surface` belongs to that view. */
export function activeViewEditorFor(surface: Element): Editor | null {
    const state = useDocument.getState();
    const cell = state.activeViewId === null ? null : cellElement(state.activeViewId);

    return cell !== null && cell.contains(surface) ? recentEditorIn(cell) : null;
}
