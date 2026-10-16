import type { CanvasState } from '@/state/canvas';
import type { GapNode } from '@/canvas/editable-gaps';
import { lineBounds } from '@/canvas/line-geometry';

export function gapFrames(state: Pick<CanvasState, 'nodes' | 'lines' | 'hidden'>): Record<string, GapNode> {
    return Object.fromEntries([
        ...Object.values(state.nodes)
            .filter((node) => !state.hidden.has(node.id))
            .map((node) => [node.id, node] as const),
        ...Object.values(state.lines)
            .filter((line) => !state.hidden.has(line.id))
            .map((line) => [line.id, { ...lineBounds(line), id: line.id, kind: 'line' }] as const)
    ]);
}
