import type { Point, Rect } from '@/canvas/math';
import { HINT_HOT, HINT_REACH } from '@/canvas/port-hints';

/* Screen pixels: a handle keeps its size at every zoom, the way a port does. */
const PILL = 36;
const PILL_MIN = 12;
export const RESIZE_CORNER = 22;
/* Half the span along an edge that belongs to the port in its middle. */
const PORT_CLEAR = 14;
/* How far out the pill sits, the middle of the band a press takes. */
const OUT = HINT_HOT / 2;

export type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

type ResizeSide = 'n' | 's' | 'e' | 'w';

export interface ResizeHandle {
    nodeId: string;
    edge: ResizeEdge;
    /* The middle of the pill, or the corner itself, in world units. */
    at: Point;
    /* Of the pill along its edge in world units; 0 for a corner. */
    length: number;
    /* 0 where it fades in, 1 with the pointer close enough to aim at it. */
    strength: number;
    hot: boolean;
}

export interface ResizeCandidate extends Rect {
    id: string;
    /* A group is a frame under its nodes: a pointer inside one is still out on the canvas. */
    group: boolean;
}

/*
 * The handle a pointer at `point` brings up: on the nearest node within reach, and only while the
 * pointer is outside every node, so the content of a node keeps every pixel of its own.
 */
export function resizeHandle(nodes: readonly ResizeCandidate[], point: Point, zoom: number): ResizeHandle | null {
    if (nodes.some((node) => !node.group && contains(node, point))) {
        return null;
    }
    const reach = HINT_REACH / zoom;
    let nearest: { node: ResizeCandidate; distance: number } | null = null;
    for (const node of nodes) {
        if (contains(node, point)) {
            continue;
        }
        const distance = distanceTo(node, point);
        if (distance <= reach && (nearest === null || distance < nearest.distance)) {
            nearest = { node, distance };
        }
    }
    if (nearest === null) {
        return null;
    }
    const { node, distance } = nearest;
    const strength = Math.min(1, (reach - distance) / (reach / 2));
    const near = distance * zoom <= HINT_HOT;
    const outX = point.x < node.x ? -1 : point.x > node.x + node.w ? 1 : 0;
    const outY = point.y < node.y ? -1 : point.y > node.y + node.h ? 1 : 0;
    if (outX !== 0 && outY !== 0) {
        return cornerHandle(node, cornerOf(outY < 0 ? 'n' : 's', outX < 0 ? 'w' : 'e'), strength, near);
    }
    const side: ResizeSide = outY < 0 ? 'n' : outY > 0 ? 's' : outX < 0 ? 'w' : 'e';
    return sideHandle(node, side, point, zoom, strength, near);
}

/* The handle under a resize that is running: on the edge it started from, following the pointer. */
export function heldHandle(node: Rect & { id: string }, edge: ResizeEdge, point: Point, zoom: number): ResizeHandle {
    if (edge.length === 2) {
        return cornerHandle(node, edge, 1, true);
    }
    return sideHandle(node, edge as ResizeSide, point, zoom, 1, true, true)!;
}

/*
 * The three points a handle is drawn through, clockwise around its node whatever its shape, so a pill
 * that slides into a corner bends into it point for point instead of turning over.
 */
export function handlePoints(handle: ResizeHandle, zoom: number): [Point, Point, Point] {
    const { x, y } = handle.at;
    const half = handle.length / 2;
    const arm = 12 / zoom;
    const out = 4 / zoom;
    switch (handle.edge) {
        case 'n':
            return [
                { x: x - half, y },
                { x, y },
                { x: x + half, y }
            ];
        case 'e':
            return [
                { x, y: y - half },
                { x, y },
                { x, y: y + half }
            ];
        case 's':
            return [
                { x: x + half, y },
                { x, y },
                { x: x - half, y }
            ];
        case 'w':
            return [
                { x, y: y + half },
                { x, y },
                { x, y: y - half }
            ];
        case 'ne': {
            const tip = { x: x + out, y: y - out };
            return [{ x: tip.x - arm, y: tip.y }, tip, { x: tip.x, y: tip.y + arm }];
        }
        case 'se': {
            const tip = { x: x + out, y: y + out };
            return [{ x: tip.x, y: tip.y - arm }, tip, { x: tip.x - arm, y: tip.y }];
        }
        case 'sw': {
            const tip = { x: x - out, y: y + out };
            return [{ x: tip.x + arm, y: tip.y }, tip, { x: tip.x, y: tip.y - arm }];
        }
        case 'nw': {
            const tip = { x: x - out, y: y - out };
            return [{ x: tip.x, y: tip.y + arm }, tip, { x: tip.x + arm, y: tip.y }];
        }
    }
}

function sideHandle(
    node: Rect & { id: string },
    side: ResizeSide,
    point: Point,
    zoom: number,
    strength: number,
    near: boolean,
    held = false
): ResizeHandle | null {
    const horizontal = side === 'n' || side === 's';
    const length = (horizontal ? node.w : node.h) * zoom;
    const along = (horizontal ? point.x - node.x : point.y - node.y) * zoom;
    const pill = Math.min(PILL, length / 2 - PORT_CLEAR - RESIZE_CORNER);
    const startCorner = horizontal ? cornerOf(side, 'w') : cornerOf('n', side);
    const endCorner = horizontal ? cornerOf(side, 'e') : cornerOf('s', side);
    if (pill < PILL_MIN) {
        if (held) {
            return { ...pillAt(node, side, length / 2, PILL_MIN, zoom), strength, hot: near };
        }
        return cornerHandle(node, along < length / 2 ? startCorner : endCorner, strength, near);
    }
    if (!held && along < RESIZE_CORNER) {
        return cornerHandle(node, startCorner, strength, near);
    }
    if (!held && along > length - RESIZE_CORNER) {
        return cornerHandle(node, endCorner, strength, near);
    }
    // The middle of an edge is the port's: near it the pointer gets the port and no handle.
    if (!held && Math.abs(along - length / 2) < PORT_CLEAR + pill / 2) {
        return null;
    }
    const middle = Math.max(RESIZE_CORNER + pill / 2, Math.min(length - RESIZE_CORNER - pill / 2, along));
    const onPill = Math.abs(along - middle) <= pill / 2;
    return { ...pillAt(node, side, middle, pill, zoom), strength, hot: near && (held || onPill) };
}

function pillAt(node: Rect & { id: string }, side: ResizeSide, middle: number, pill: number, zoom: number): Omit<ResizeHandle, 'strength' | 'hot'> {
    const out = OUT / zoom;
    const at =
        side === 'n'
            ? { x: node.x + middle / zoom, y: node.y - out }
            : side === 's'
              ? { x: node.x + middle / zoom, y: node.y + node.h + out }
              : side === 'w'
                ? { x: node.x - out, y: node.y + middle / zoom }
                : { x: node.x + node.w + out, y: node.y + middle / zoom };
    return { nodeId: node.id, edge: side, at, length: pill / zoom };
}

function cornerHandle(node: Rect & { id: string }, edge: ResizeEdge, strength: number, hot: boolean): ResizeHandle {
    const at = { x: edge.includes('w') ? node.x : node.x + node.w, y: edge.includes('n') ? node.y : node.y + node.h };
    return { nodeId: node.id, edge, at, length: 0, strength, hot };
}

function cornerOf(vertical: 'n' | 's', horizontal: 'w' | 'e'): ResizeEdge {
    return `${vertical}${horizontal}`;
}

function contains(rect: Rect, point: Point): boolean {
    return point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h;
}

function distanceTo(rect: Rect, point: Point): number {
    const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.w));
    const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.h));
    return Math.hypot(dx, dy);
}
