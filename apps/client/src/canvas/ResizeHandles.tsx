import { memo, useMemo, useState, type RefObject } from 'react';
import { HINT_HOT } from '@/canvas/port-hints';
import { handlePoints, heldHandle, RESIZE_CORNER, resizeHandle, type ResizeCandidate, type ResizeEdge, type ResizeHandle } from '@/canvas/resize-handles';
import { useWorldPointer } from '@/canvas/use-world-pointer';
import { useCanvas } from '@/state/canvas';

const CURSOR: Record<ResizeEdge, string> = {
    n: 'cursor-ns-resize',
    s: 'cursor-ns-resize',
    e: 'cursor-ew-resize',
    w: 'cursor-ew-resize',
    ne: 'cursor-nesw-resize',
    sw: 'cursor-nesw-resize',
    nw: 'cursor-nwse-resize',
    se: 'cursor-nwse-resize'
};

/*
 * The resize handle a node offers the pointer that comes near it, outside its frame so the content
 * keeps every pixel. Like a port it belongs to the canvas: one handle at a time, on the nearest node.
 */
export const ResizeHandles = memo(function ResizeHandles({ rootRef }: { rootRef: RefObject<HTMLDivElement | null> }) {
    const nodes = useCanvas((s) => s.nodes);
    const hidden = useCanvas((s) => s.hidden);
    const zoom = useCanvas((s) => s.camera.zoom);
    const locked = useCanvas((s) => s.locks.resize);
    const resizing = useCanvas((s) => s.resizing);
    const quiet = useCanvas((s) => (s.gesturing && s.resizing === null) || s.linkDraft !== null);
    const point = useWorldPointer(rootRef);
    // The edge a press took, so a running resize keeps it whatever the pointer passes over.
    const [grabbed, setGrabbed] = useState<{ nodeId: string; edge: ResizeEdge } | null>(null);

    const candidates = useMemo<ResizeCandidate[]>(
        () =>
            Object.values(nodes)
                .filter((node) => !hidden.has(node.id) && !(node.kind === 'group' && node.collapsed === true))
                .map(({ id, x, y, w, h, kind }) => ({ id, x, y, w, h, group: kind === 'group' })),
        [hidden, nodes]
    );

    const handle = useMemo(() => {
        if (locked || point === null) {
            return null;
        }
        if (resizing !== null) {
            const node = nodes[resizing];
            return grabbed?.nodeId === resizing && node !== undefined ? heldHandle(node, grabbed.edge, point, zoom) : null;
        }
        return quiet ? null : resizeHandle(candidates, point, zoom);
    }, [candidates, grabbed, locked, nodes, point, quiet, resizing, zoom]);

    if (handle === null) {
        return null;
    }
    const corner = handle.edge.length === 2;
    const points = handlePoints(handle, zoom)
        .map(({ x, y }) => `${x} ${y}`)
        .join(' L ');
    return (
        <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1">
            <g style={{ opacity: handle.strength }} onPointerDown={() => setGrabbed({ nodeId: handle.nodeId, edge: handle.edge })}>
                {corner ? <CornerArea handle={handle} zoom={zoom} /> : <PillArea handle={handle} zoom={zoom} />}
                {/* One path for every shape, so moving from an edge into a corner bends the same handle.
                    Keyed on the zoom, or a zoom step would glide where it should jump. */}
                <path
                    key={`${handle.nodeId}:${zoom}`}
                    fill="none"
                    stroke={handle.hot ? 'var(--accent)' : 'var(--edge-line)'}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="transition-[d,stroke-width,stroke] duration-150 ease-out motion-reduce:transition-none"
                    style={{ d: `path("M ${points}")`, strokeWidth: (corner ? 2 : 4) / zoom }}
                />
            </g>
        </svg>
    );
});

function PillArea({ handle, zoom }: { handle: ResizeHandle; zoom: number }) {
    const horizontal = handle.edge === 'n' || handle.edge === 's';
    const band = HINT_HOT / zoom;
    const along = handle.length;
    return (
        <rect
            data-resize={handle.edge}
            data-resize-node={handle.nodeId}
            x={handle.at.x - (horizontal ? along : band) / 2}
            y={handle.at.y - (horizontal ? band : along) / 2}
            width={horizontal ? along : band}
            height={horizontal ? band : along}
            fill="transparent"
            className={`pointer-events-auto ${CURSOR[handle.edge]}`}
        />
    );
}

function CornerArea({ handle, zoom }: { handle: ResizeHandle; zoom: number }) {
    const sx = handle.edge.includes('w') ? -1 : 1;
    const sy = handle.edge.includes('n') ? -1 : 1;
    const { x, y } = handle.at;
    const band = HINT_HOT / zoom;
    const reach = RESIZE_CORNER / zoom;
    // An L around the outside of the corner: a press beside either edge near it, or past the corner itself.
    const area = [
        [x + sx * band, y + sy * band],
        [x - sx * reach, y + sy * band],
        [x - sx * reach, y],
        [x, y],
        [x, y - sy * reach],
        [x + sx * band, y - sy * reach]
    ]
        .map(([px, py]) => `${px},${py}`)
        .join(' ');
    return (
        <polygon
            data-resize={handle.edge}
            data-resize-node={handle.nodeId}
            points={area}
            fill="transparent"
            className={`pointer-events-auto ${CURSOR[handle.edge]}`}
        />
    );
}
