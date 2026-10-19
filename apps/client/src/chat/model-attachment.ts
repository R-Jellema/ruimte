import { isModelMime } from '@ruimte/contracts';

// An STL has no magic: a binary one is an 80-byte header, a triangle count and 50 bytes per triangle.
const STL_HEADER_BYTES = 84;
const STL_TRIANGLE_BYTES = 50;

function startsWith(bytes: Uint8Array, text: string): boolean {
    return bytes.length >= text.length && Array.from(text).every((char, index) => bytes[index] === char.charCodeAt(0));
}

function isBinaryStl(bytes: Uint8Array): boolean {
    if (bytes.length < STL_HEADER_BYTES) {
        return false;
    }
    const triangles = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(80, true);
    return triangles > 0 && bytes.length === STL_HEADER_BYTES + STL_TRIANGLE_BYTES * triangles;
}

/*
 * The model type of an attachment's bytes, or null for bytes that are none. A blob URL of a direct
 * connection carries no type of its own, so the bytes decide unless the response named a model type.
 * The machine checked the bytes when the agent attached them; this only tells the three formats apart.
 */
export function modelMimeOf(bytes: Uint8Array, claimed: string): string | null {
    if (isModelMime(claimed)) {
        return claimed;
    }
    if (startsWith(bytes, 'glTF')) {
        return 'model/gltf-binary';
    }
    if (startsWith(bytes, 'PK\u0003\u0004')) {
        return 'model/vnd.usdz+zip';
    }
    if (isBinaryStl(bytes) || /^\s*solid(\s|$)/i.test(new TextDecoder('latin1').decode(bytes.subarray(0, 256)))) {
        return 'model/stl';
    }
    return null;
}
