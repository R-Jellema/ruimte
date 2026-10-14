import { isCanvasView, isSessionView, withNodeAsView, withNodeOnView, withViewAsNode } from '@ruimte/contracts';
import { dropView, locateView } from '@/shell/split';
import { NODE_SIZE } from '@/state/canvas';
import type { DocumentState } from '@/state/document';
import { centerOfView, withRenamedNode, type DocumentKit } from '@/state/document-model';

/* Nodes moving between views: to another canvas, off a canvas into a view of their own, and back. */
export function createDocumentNodesSlice({
    set,
    get,
    peers,
    commit,
    write
}: DocumentKit): Pick<DocumentState, 'moveNodeToView' | 'renameNodeOnView' | 'updateStandalone' | 'openAsView' | 'putOnCanvas'> {
    return {
        moveNodeToView(nodeId, viewId) {
            const state = get();
            if (viewId === state.activeViewId) {
                return;
            }
            const views = state.exportViews();
            const source = views.find((view) => isCanvasView(view) && view.nodes.some((node) => node.id === nodeId));
            const size = source && isCanvasView(source) ? source.nodes.find((candidate) => candidate.id === nodeId) : undefined;
            const moved = withNodeOnView(views, nodeId, viewId, centerOfView(viewId, state.viewLocal[viewId], size ?? { w: 0, h: 0 }, peers) ?? undefined);
            if (moved === null || !source) {
                return;
            }
            write(moved.views);
            const editor = peers.canvases.peek(source.id);
            if (editor) {
                // The canvas it left is on screen, so it has to lose the node without losing its camera.
                const after = moved.views.find((view) => view.id === source.id);
                editor.getState().loadView(after && isCanvasView(after) ? after : null, { camera: editor.getState().viewCamera(), focusedNodeId: null });
            }
        },

        renameNodeOnView(viewId, nodeId, title, source = 'user') {
            const editor = peers.canvases.peek(viewId);
            if (editor) {
                editor.getState().renameNode(nodeId, title, source);
                return;
            }
            write(withRenamedNode(get().views, viewId, nodeId, title, source));
        },

        updateStandalone(id, patch) {
            set((state) => ({
                views: state.views.map((view) => {
                    if (view.id !== id || !isSessionView(view)) {
                        return view;
                    }
                    if (view.kind === 'browser') {
                        return patch.url === undefined ? view : { ...view, url: patch.url };
                    }
                    if (view.kind === 'device') {
                        return view;
                    }
                    const { url: _url, ...node } = patch;
                    return { ...view, node: { ...view.node, ...node } };
                }),
                edits: state.edits + 1
            }));
        },

        openAsView(nodeId) {
            const views = get().exportViews();
            const source = views.find((view) => isCanvasView(view) && view.nodes.some((node) => node.id === nodeId));
            const promoted = withNodeAsView(views, nodeId);
            if (promoted === null || !source) {
                return null;
            }
            write(promoted.views);
            const editor = peers.canvases.peek(source.id);
            if (editor) {
                const stripped = promoted.views.find((view) => view.id === source.id);
                editor
                    .getState()
                    .loadView(stripped && isCanvasView(stripped) ? stripped : null, { camera: editor.getState().viewCamera(), focusedNodeId: null });
            }
            get().setActiveView(promoted.view.id);
            return promoted.view.id;
        },

        putOnCanvas(viewId, canvasViewId) {
            const state = get();
            const views = state.exportViews();
            const source = views.find((view) => view.id === viewId);
            const size = source && isSessionView(source) ? NODE_SIZE[source.kind] : { w: 0, h: 0 };
            const at = centerOfView(canvasViewId, state.viewLocal[canvasViewId], size, peers) ?? { x: 0, y: 0 };
            const landed = withViewAsNode(views, viewId, canvasViewId, at);
            if (landed === null) {
                return false;
            }
            const { views: next, node } = landed;
            const { [viewId]: _gone, ...viewLocal } = state.viewLocal;
            set({ views: next, viewLocal, edits: state.edits + 1 });
            /* The view it was is gone from the list, so the cell it stood in takes the canvas it
               landed on; from anywhere else the canvas simply comes up in the focused cell. */
            const standing = state.layout === null ? null : locateView(state.layout, viewId);
            if (state.layout !== null && standing !== null) {
                commit(dropView(state.layout, canvasViewId, standing, 'center'));
            } else {
                get().setActiveView(canvasViewId);
            }
            const editor = peers.canvases.peek(canvasViewId);
            editor?.getState().select([node.id]);
            editor?.getState().goToNode(node.id);
            return true;
        }
    };
}
