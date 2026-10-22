import { isCanvasView } from '@ruimte/contracts';
import { focusedCanvas } from '@/state/canvas';
import { activeViewOf, useDocument } from '@/state/document';
import { endpointKey } from '@/state/keys';
import { endpointOfNodeId } from '@/state/node-endpoint';

/* The chat a command means: a chat view in the focused cell, or on its canvas the chat node with the keyboard, else the one selected alone. */
export function focusedChatId(): string | null {
    const view = activeViewOf(useDocument.getState());
    if (view === null) {
        return null;
    }
    if (!isCanvasView(view)) {
        return view.kind === 'chat' ? view.id : null;
    }
    const { bodyFocusId, selection, nodes } = focusedCanvas().getState();
    const id = bodyFocusId ?? (selection.length === 1 ? selection[0]! : null);
    return id !== null && nodes[id]?.kind === 'chat' ? id : null;
}

/* The key that chat's composer registers under, on the machine the chat runs on, so a menu row and its shortcut reach the same composer. */
export function focusedChatComposerKey(): string | null {
    const chat = focusedChatId();
    return chat === null ? null : endpointKey(endpointOfNodeId(chat), chat);
}
