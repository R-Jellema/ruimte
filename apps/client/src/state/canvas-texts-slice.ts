import { snapToGrid } from '@/canvas/math';
import type { CanvasState } from '@/state/canvas';
import { nextId, remember, type CanvasSet, type TextElement } from '@/state/canvas-model';

/* The labels on the canvas. */
export function createCanvasTextsSlice(set: CanvasSet): Pick<CanvasState, 'addText' | 'updateText' | 'styleText' | 'resizeText' | 'setEditingText'> {
    return {
        addText(at) {
            const id = nextId('text');
            const text: TextElement = { id, x: snapToGrid(at.x), y: snapToGrid(at.y), text: '', size: 18 };
            set((s) => ({ texts: { ...s.texts, [id]: text }, selection: [id], editingTextId: id, ...remember(s) }));
            return id;
        },
        updateText(id, text) {
            set((s) => (s.texts[id] ? { texts: { ...s.texts, [id]: { ...s.texts[id], text } } } : {}));
        },
        styleText(id, patch, undoable = true) {
            set((s) => (s.texts[id] ? { texts: { ...s.texts, [id]: { ...s.texts[id], ...patch } }, ...(undoable ? remember(s) : {}) } : {}));
        },
        resizeText(id, x, maxWidth, undoable = true) {
            set((s) => (s.texts[id] ? { texts: { ...s.texts, [id]: { ...s.texts[id], x, maxWidth } }, ...(undoable ? remember(s) : {}) } : {}));
        },
        setEditingText(id) {
            set({ editingTextId: id });
        }
    };
}
