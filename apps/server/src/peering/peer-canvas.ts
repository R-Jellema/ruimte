import { isDeepStrictEqual } from 'node:util';
import { NODE_SIZE, type PeerNode, type ProjectCanvasView, type ProjectNode, type ProjectView } from '@ruimte/contracts';

// The mirror is never looked at, so its nodes only need a place of their own and a size that holds.
const COLUMNS = 3;
const GAP = 40;

/* A node of another machine as this machine's canvas keeps it, at the place its order gives it. */
export function nodeOf(node: PeerNode, index: number): ProjectNode {
    const { w, h } = NODE_SIZE[node.kind];
    return { ...node, x: (index % COLUMNS) * (w + GAP), y: Math.floor(index / COLUMNS) * (h + GAP), w, h };
}

/* What the other machine drew of a node, without the place and size this machine gave it. */
export function peerNodeOf(node: ProjectNode): PeerNode | null {
    if (node.kind !== 'terminal' && node.kind !== 'chat' && node.kind !== 'device') {
        return null;
    }
    const { x: _x, y: _y, w: _w, h: _h, ...rest } = node;
    return rest as PeerNode;
}

/* Hidden is laid over the document and is no part of what the other machine drew. */
export function sameCanvas(held: ProjectView, next: ProjectCanvasView): boolean {
    const { hidden: _hidden, ...rest } = held as ProjectCanvasView;
    return isDeepStrictEqual(rest, next);
}

/* The canvas as the other machine's nodes left it, without the flag laid over it. */
export function stripHidden(canvas: ProjectCanvasView): ProjectCanvasView {
    const { hidden: _hidden, ...rest } = canvas;
    return rest;
}
