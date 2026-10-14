import { describe, expect, test } from 'bun:test';
import { createCanvasStore } from '@/state/canvas';
import { notePointer, pointerInWorld } from './pointer';

describe('the pointer over a canvas', () => {
    test('is read in world units through the camera as it is when asked', () => {
        const store = createCanvasStore();
        store.setState({ camera: { x: 100, y: 50, zoom: 2 } });
        notePointer(store, { x: 300, y: 250 });
        expect(pointerInWorld(store)).toEqual({ x: 100, y: 100 });
        store.setState({ camera: { x: 0, y: 0, zoom: 1 } });
        expect(pointerInWorld(store)).toEqual({ x: 300, y: 250 });
    });

    test('is gone once it left, and is kept per canvas', () => {
        const left = createCanvasStore();
        const right = createCanvasStore();
        notePointer(left, { x: 10, y: 20 });
        expect(pointerInWorld(right)).toBeNull();
        notePointer(left, null);
        expect(pointerInWorld(left)).toBeNull();
    });
});
