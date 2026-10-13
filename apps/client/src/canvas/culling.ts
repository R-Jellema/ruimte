import { useEffect, useState } from 'react';
import type { Viewport } from '@/canvas/camera-slice';
import { intersects, visibleRect, type Camera } from '@/canvas/math';
import { useCanvas, type CanvasNode } from '@/state/canvas';
import { memoByIdentity } from '@/state/identity-memo';

/* Screen pixels around the viewport that still count as visible, so an edge does not flicker. */
export const VIEW_MARGIN = 96;
/* How long a node stays live after leaving the viewport; a pan across it never thrashes. */
const OFFSCREEN_GRACE_MS = 10_000;

/* The nodes in sight, found once per camera: every node asks on every move of it and gets this one answer. */
export const visibleNodeIds = memoByIdentity((nodes: Record<string, CanvasNode>, camera: Camera, viewport: Viewport): ReadonlySet<string> => {
    const rect = visibleRect(camera, viewport, VIEW_MARGIN);
    return new Set(
        Object.values(nodes)
            .filter((node) => intersects(node, rect))
            .map((node) => node.id)
    );
});

export function useNodeInViewport(id: string): boolean {
    return useCanvas((s) => !s.nodes[id] || s.viewport.w === 0 || visibleNodeIds(s.nodes, s.camera, s.viewport).has(id));
}

/*
 * Under this a node is a few dozen pixels tall, a shape on the canvas rather than something anyone
 * is reading. What costs nothing to draw ignores it; a body that costs a read and a syntax
 * highlighter shows its plate instead, which is what keeps a canvas full of files moving.
 */
export const READABLE_ZOOM = 0.4;

export function useReadableZoom(): boolean {
    return useCanvas((s) => s.camera.zoom >= READABLE_ZOOM);
}

/* True while visible and for a grace period after; the caller unmounts the live view when it turns false. */
export function useHeldWhileVisible(visible: boolean): boolean {
    const [held, setHeld] = useState(true);
    // Re-arming the hold is derived while rendering: an effect would cost an extra render each time.
    if (visible && !held) {
        setHeld(true);
    }
    useEffect(() => {
        if (visible) {
            return;
        }
        const timer = window.setTimeout(() => setHeld(false), OFFSCREEN_GRACE_MS);
        return () => window.clearTimeout(timer);
    }, [visible]);
    return visible || held;
}
