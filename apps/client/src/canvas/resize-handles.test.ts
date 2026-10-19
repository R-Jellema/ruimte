import { describe, expect, test } from 'bun:test';
import { handlePath, heldHandle, resizeHandle, type ResizeCandidate } from '@/canvas/resize-handles';

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

describe('handlePath', () => {
    const ends = (path: string): number[][] => {
        const numbers = path.match(/-?[\d.]+/g)!.map(Number);
        return [numbers.slice(0, 2), numbers.slice(-2)];
    };

    test('a corner keeps the distance of the pill from the frame', () => {
        const pill = resizeHandle([node], { x: 340, y: -5 }, 1)!;
        const corner = resizeHandle([node], { x: 395, y: -5 }, 1)!;
        const [[, pillY]] = ends(handlePath(pill, 1));
        const [[, cornerY], [cornerX]] = ends(handlePath(corner, 1));
        expect(cornerY).toBe(pillY);
        expect(cornerX).toBe(400 - pillY);
    });

    test('draws every shape with the same commands, so one can glide into the other', () => {
        const pill = handlePath(resizeHandle([node], { x: 340, y: -5 }, 1)!, 1);
        const corner = handlePath(resizeHandle([node], { x: 395, y: -5 }, 1)!, 1);
        expect(pill.replace(/[-\d. ]+/g, '')).toBe(corner.replace(/[-\d. ]+/g, ''));
    });
});
