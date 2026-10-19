import { describe, expect, test } from 'bun:test';
import { handleRail, heldHandle, resizeHandle, type ResizeCandidate } from '@/canvas/resize-handles';

const node: ResizeCandidate = { id: 'a', x: 0, y: 0, w: 400, h: 200, group: false };

describe('resizeHandle', () => {
    test('offers nothing to a pointer out of reach', () => {
        expect(resizeHandle([node], { x: 200, y: -80 }, 1)).toBeNull();
    });

    test('offers nothing to a pointer inside a node, so the content keeps its pixels', () => {
        expect(resizeHandle([node], { x: 398, y: 100 }, 1)).toBeNull();
    });

    test('a pill on the nearest edge follows the pointer along it', () => {
        const handle = resizeHandle([node], { x: 100, y: -5 }, 1);
        expect(handle).toMatchObject({ nodeId: 'a', edge: 'n', length: 36, hot: true });
        expect(handle?.at.x).toBe(100);
        expect(handle?.at.y).toBeLessThan(0);
    });

    test('leaves the middle of an edge to the port', () => {
        expect(resizeHandle([node], { x: 205, y: -5 }, 1)).toBeNull();
        expect(resizeHandle([node], { x: 240, y: -5 }, 1)?.edge).toBe('n');
    });

    test('near the end of an edge it becomes the corner', () => {
        expect(resizeHandle([node], { x: 395, y: -6 }, 1)?.edge).toBe('ne');
        expect(resizeHandle([node], { x: -6, y: 206 }, 1)?.edge).toBe('sw');
    });

    test('a short edge leaves only the corners', () => {
        const small: ResizeCandidate = { id: 'b', x: 0, y: 0, w: 100, h: 60, group: false };
        expect(resizeHandle([small], { x: 106, y: 25 }, 1)?.edge).toBe('ne');
    });

    test('keeps its size on the screen at every zoom', () => {
        expect(resizeHandle([node], { x: 100, y: -5 }, 2)?.length).toBe(18);
    });

    test('a pointer inside a group still reaches the node in it, and not the group', () => {
        const group: ResizeCandidate = { id: 'g', x: -100, y: -100, w: 700, h: 500, group: true };
        expect(resizeHandle([group, node], { x: 100, y: -5 }, 1)?.nodeId).toBe('a');
    });

    test('a pointer inside another node offers nothing for the node beside it', () => {
        const neighbor: ResizeCandidate = { id: 'c', x: 404, y: 0, w: 200, h: 200, group: false };
        expect(resizeHandle([node, neighbor], { x: 405, y: 50 }, 1)).toBeNull();
        expect(resizeHandle([node, neighbor], { x: 401, y: 50 }, 1)?.nodeId).toBe('a');
    });
});

describe('heldHandle', () => {
    test('keeps its edge while the pointer passes inside the node', () => {
        const handle = heldHandle(node, 'e', { x: 300, y: 50 }, 1);
        expect(handle).toMatchObject({ edge: 'e', hot: true, strength: 1 });
        expect(handle.at.x).toBeGreaterThan(400);
    });
});

describe('handleRail', () => {
    test('a pill and the corner it slides into run on the same rail, the corner round the bend', () => {
        const pill = handleRail(node, resizeHandle([node], { x: 340, y: -5 }, 1)!, 1);
        const corner = handleRail(node, resizeHandle([node], { x: 395, y: -5 }, 1)!, 1);
        expect(corner.path).toBe(pill.path);
        expect(pill.length).toBe(36);
        expect(corner.from).toBeGreaterThan(pill.from + pill.length);
        expect(corner.length).toBeGreaterThan(pill.length / 2);
    });

    test('a pill sits on the rail where the pointer is', () => {
        const rail = handleRail(node, resizeHandle([node], { x: 100, y: -5 }, 1)!, 1);
        const radius = 12 + 7;
        // Half the left side up, the bend, then along the top to the pill's start.
        const top = (200 + 14) / 2 - radius + (Math.PI * radius) / 2;
        expect(rail.from).toBeCloseTo(top + (100 - 18) - (-7 + radius));
    });
});
