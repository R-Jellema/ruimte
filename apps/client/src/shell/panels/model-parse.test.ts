import { describe, expect, test } from 'bun:test';
import { Box3, type Mesh, type MeshStandardMaterial } from 'three';
import { parseModel } from './model-parse';
import { countGeometry } from './model-view';

/* A binary STL of one triangle standing up along Z, with an optional per-face color. */
function binaryStl(color?: [number, number, number]): ArrayBuffer {
    const view = new DataView(new ArrayBuffer(84 + 50));
    if (color !== undefined) {
        // The header names a default color, and bit 15 of a face's attribute says it has its own.
        [...'COLOR='].forEach((char, index) => view.setUint8(index, char.charCodeAt(0)));
        [255, 255, 255, 255].forEach((value, index) => view.setUint8(6 + index, value));
    }
    view.setUint32(80, 1, true);
    const vertices = [0, 0, 0, 1, 0, 0, 0, 0, 2];
    vertices.forEach((value, index) => view.setFloat32(84 + 12 + index * 4, value, true));
    if (color !== undefined) {
        const [red, green, blue] = color.map((value) => Math.round(value * 31));
        view.setUint16(84 + 48, red | (green << 5) | (blue << 10), true);
    }
    return view.buffer;
}

const ASCII_STL = `solid part
  facet normal 0 -1 0
    outer loop
      vertex 0 0 0
      vertex 1 0 0
      vertex 0 0 2
    endloop
  endfacet
  facet normal 0 -1 0
    outer loop
      vertex 1 0 0
      vertex 1 0 2
      vertex 0 0 2
    endloop
  endfacet
endsolid part
`;

describe('parsing an STL', () => {
    test('reads a binary STL as one mesh and stands its Z axis up', async () => {
        const { root, animations } = await parseModel(binaryStl(), 'model/stl', '');
        expect(countGeometry(root)).toEqual({ vertices: 3, triangles: 1 });
        expect(animations).toEqual([]);
        const box = new Box3().setFromObject(root);
        expect(box.max.y).toBeCloseTo(2);
        expect(box.min.z).toBeCloseTo(0);
    });

    test('reads an ASCII STL the same way', async () => {
        const bytes = new TextEncoder().encode(ASCII_STL).buffer as ArrayBuffer;
        const { root } = await parseModel(bytes, 'model/stl', '');
        expect(countGeometry(root)).toEqual({ vertices: 6, triangles: 2 });
        expect(new Box3().setFromObject(root).max.y).toBeCloseTo(2);
    });

    test('gives a plain STL one neutral material and keeps the colors of a colored one', async () => {
        const plain = (await parseModel(binaryStl(), 'model/stl', '')).root as Mesh;
        expect((plain.material as MeshStandardMaterial).vertexColors).toBe(false);
        const colored = (await parseModel(binaryStl([1, 0, 0]), 'model/stl', '')).root as Mesh;
        expect((colored.material as MeshStandardMaterial).vertexColors).toBe(true);
        expect(colored.geometry.getAttribute('color')).toBeDefined();
    });
});
