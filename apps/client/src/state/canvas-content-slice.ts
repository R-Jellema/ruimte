import { cameraOfView } from '@/canvas/math';
import type { CanvasPatch } from '@/project/merge';
import type { CanvasState } from '@/state/canvas';
import { hiddenIn, patchSnapshot, snapshotOf, type CanvasGet, type CanvasNode, type CanvasSet } from '@/state/canvas-model';

/* The content as a whole: a view loaded in, a change of another writer taken in, the content handed back, and undo. */
export function createCanvasContentSlice(set: CanvasSet, get: CanvasGet): Pick<CanvasState, 'loadView' | 'applyExternal' | 'exportContent' | 'undo' | 'redo'> {
    return {
        loadView(view, local) {
            const nodes = view ? Object.fromEntries(view.nodes.map((node) => [node.id, node])) : {};
            const texts = view ? Object.fromEntries(view.texts.map((text) => [text.id, text])) : {};
            set({
                loading: true,
                viewId: view?.id ?? null,
                nodes,
                order: view ? view.nodes.map((node) => node.id) : [],
                texts,
                edges: view?.edges ?? [],
                layouts: view?.layouts ?? [],
                linkDraft: null,
                hidden: hiddenIn(nodes),
                selection: [],
                bodyFocusId: null,
                maximizedId: null,
                editingTextId: null,
                resizing: null,
                navigationId: null,
                gapMove: null,
                panning: false,
                gesturing: false,
                past: [],
                future: [],
                pendingCamera: null,
                // A reload in place hands over no locks and keeps the ones it has.
                ...(local?.locks ? { locks: local.locks } : {})
            });
            const stored = local?.camera ?? null;
            const camera = stored === null ? null : cameraOfView(stored, get().viewport);
            if (stored !== null) {
                set(camera === null ? { pendingCamera: { kind: 'view', view: stored } } : { camera });
            }
            set({ loading: false });
            // No camera for this view on this machine, so it opens on everything it holds, once there is room.
            if (stored === null) {
                get().fitAll();
            }
        },
        applyExternal(patch) {
            set((s) => {
                const arrived: CanvasPatch = {
                    ...patch,
                    nodes: patch.nodes.filter((node) => s.nodes[node.id] === undefined),
                    texts: patch.texts.filter((text) => s.texts[text.id] === undefined),
                    edges: patch.edges.filter((edge) => !s.edges.some((held) => held.id === edge.id))
                };
                const reshapes =
                    arrived.nodes.length + arrived.texts.length + arrived.edges.length > 0 ||
                    patch.removed.nodes.length + patch.removed.texts.length + patch.removed.edges.length > 0;
                const gone = new Set([...patch.removed.nodes, ...patch.removed.texts, ...patch.removed.edges]);
                const nodes: Record<string, CanvasNode> = { ...s.nodes };
                for (const id of patch.removed.nodes) {
                    delete nodes[id];
                }
                // Spread over what the editor holds, so what only lives here (a browser's status) stays.
                for (const node of patch.nodes) {
                    const held = nodes[node.id];
                    nodes[node.id] = held ? { ...held, ...node } : node;
                }
                const texts = { ...s.texts };
                for (const id of patch.removed.texts) {
                    delete texts[id];
                }
                for (const text of patch.texts) {
                    const held = texts[text.id];
                    texts[text.id] = held ? { ...held, ...text } : text;
                }
                const arriving = new Map(patch.edges.map((edge) => [edge.id, edge]));
                const edges = s.edges
                    .filter((edge) => !gone.has(edge.id))
                    .map((edge) => (arriving.has(edge.id) ? { ...edge, ...arriving.get(edge.id)! } : edge));
                const present = new Set(edges.map((edge) => edge.id));
                edges.push(...patch.edges.filter((edge) => !present.has(edge.id)));
                const hidden = hiddenIn(nodes);
                const lost = (id: string | null | undefined): boolean => id !== null && id !== undefined && gone.has(id);
                return {
                    merging: true,
                    nodes,
                    order: patch.order.filter((id) => nodes[id] !== undefined),
                    texts,
                    edges,
                    layouts: patch.layouts ?? s.layouts,
                    hidden,
                    ...(reshapes
                        ? {
                              past: s.past.map((snapshot) => patchSnapshot(snapshot, arrived)),
                              future: s.future.map((snapshot) => patchSnapshot(snapshot, arrived)),
                              ...(s.gapMove === null ? {} : { gapMove: { ...s.gapMove, snapshot: patchSnapshot(s.gapMove.snapshot, arrived) } })
                          }
                        : {}),
                    ...(gone.size === 0
                        ? {}
                        : {
                              selection: s.selection.filter((id) => !gone.has(id) && !hidden.has(id)),
                              bodyFocusId: lost(s.bodyFocusId) ? null : s.bodyFocusId,
                              editingTextId: lost(s.editingTextId) ? null : s.editingTextId,
                              resizing: lost(s.resizing) ? null : s.resizing,
                              linkDraft: lost(s.linkDraft?.from) ? null : s.linkDraft
                          })
                };
            });
            set({ merging: false });
        },
        exportContent() {
            const { nodes, order, texts, edges, layouts } = get();
            return {
                nodes: order.map((id) => nodes[id]!).map(({ status: _status, ...node }) => node),
                texts: Object.values(texts),
                edges,
                layouts
            };
        },
        undo() {
            const s = get();
            if (s.gapMove !== null) {
                return;
            }
            const previous = s.past[s.past.length - 1];
            if (!previous) {
                return;
            }
            set({
                ...previous,
                hidden: hiddenIn(previous.nodes),
                past: s.past.slice(0, -1),
                future: [snapshotOf(s), ...s.future],
                selection: [],
                bodyFocusId: null
            });
        },
        redo() {
            const s = get();
            if (s.gapMove !== null) {
                return;
            }
            const next = s.future[0];
            if (!next) {
                return;
            }
            set({
                ...next,
                hidden: hiddenIn(next.nodes),
                past: [...s.past, snapshotOf(s)],
                future: s.future.slice(1),
                selection: [],
                bodyFocusId: null
            });
        }
    };
}
