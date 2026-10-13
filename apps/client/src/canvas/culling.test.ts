import { describe, expect, test } from 'bun:test';
import type { CanvasNode } from '@/state/canvas';
import { VIEW_MARGIN, visibleNodeIds } from './culling';

function node(id: string, x: number, y: number): CanvasNode {
    return { id, kind: 'terminal', title: id, x, y, w: 200, h: 100 };
}

const nodes = { near: node('near', 0, 0), edge: node('edge', 800 + VIEW_MARGIN - 1, 0), far: node('far', 5000, 0) };
const viewport = { w: 800, h: 600 };

describe('the nodes in sight', () => {
    test('a node in the viewport or its margin is in sight, one further out is not', () => {
        expect([...visibleNodeIds(nodes, { x: 0, y: 0, zoom: 1 }, viewport)].sort()).toEqual(['edge', 'near']);
    });

    test('found once per camera, however many nodes ask', () => {
        const camera = { x: 0, y: 0, zoom: 1 };
        expect(visibleNodeIds(nodes, camera, viewport)).toBe(visibleNodeIds(nodes, camera, viewport));
    });

    test('a camera that moved finds them again', () => {
        const moved = visibleNodeIds(nodes, { x: -4900, y: 0, zoom: 1 }, viewport);
        expect([...moved]).toEqual(['far']);
    });
});
