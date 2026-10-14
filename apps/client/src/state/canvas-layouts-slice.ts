import type { ProjectLayout } from '@ruimte/contracts';
import type { CanvasState } from '@/state/canvas';
import { remember, type CanvasGet, type CanvasSet } from '@/state/canvas-model';

/* The named placements a person saves and puts the canvas back into. */
export function createCanvasLayoutsSlice(set: CanvasSet, get: CanvasGet): Pick<CanvasState, 'saveLayout' | 'putLayout' | 'applyLayout' | 'deleteLayout'> {
    return {
        saveLayout(name) {
            const s = get();
            const layout: ProjectLayout = {
                name,
                nodes: Object.fromEntries(Object.values(s.nodes).map((node) => [node.id, { x: node.x, y: node.y, w: node.w, h: node.h }])),
                texts: Object.fromEntries(Object.values(s.texts).map((text) => [text.id, { x: text.x, y: text.y }]))
            };
            get().putLayout(layout);
        },
        putLayout(layout) {
            set((s) => ({ layouts: [...s.layouts.filter((entry) => entry.name !== layout.name), layout] }));
        },
        applyLayout(name) {
            const s = get();
            const layout = s.layouts.find((entry) => entry.name === name);
            if (!layout) {
                return;
            }
            // Nodes the layout never saw stay where they are; nothing is added or removed.
            const nodes = { ...s.nodes };
            for (const [id, rect] of Object.entries(layout.nodes)) {
                if (nodes[id]) {
                    nodes[id] = { ...nodes[id], ...rect };
                }
            }
            const texts = { ...s.texts };
            for (const [id, point] of Object.entries(layout.texts)) {
                if (texts[id]) {
                    texts[id] = { ...texts[id], ...point };
                }
            }
            set({ nodes, texts, ...remember(s) });
        },
        deleteLayout(name) {
            set((s) => ({ layouts: s.layouts.filter((entry) => entry.name !== name) }));
        }
    };
}
