import { expect, test } from 'bun:test';
import { sniffImageMime } from './chat-image.ts';

function padded(prefix: readonly number[] | string, at = 0, size = 40): Uint8Array {
    const bytes = new Uint8Array(size);
    bytes.set(typeof prefix === 'string' ? [...prefix].map((character) => character.charCodeAt(0)) : prefix, at);
    return bytes;
}

test('sniffs the four attachment image types from their leading bytes', () => {
    expect(sniffImageMime(padded([137, 80, 78, 71, 13, 10, 26, 10]))).toBe('image/png');
    expect(sniffImageMime(padded([255, 216, 255, 224]))).toBe('image/jpeg');
    expect(sniffImageMime(padded('GIF89a'))).toBe('image/gif');
    const webp = padded('RIFF');
    webp.set(padded('WEBP', 0, 4), 8);
    expect(sniffImageMime(webp)).toBe('image/webp');
});

test('reads anything else, or a header cut short, as no image', () => {
    expect(sniffImageMime(padded('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
    expect(sniffImageMime(padded('GIF89a', 0, 8))).toBeNull();
    expect(sniffImageMime(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))).toBeNull();
});

function ftyp(brand: string, ...compatible: string[]): Uint8Array {
    const bytes = new Uint8Array(16 + compatible.length * 4);
    new DataView(bytes.buffer).setUint32(0, bytes.length);
    bytes.set(new TextEncoder().encode(`ftyp${brand}`), 4);
    bytes.set(new TextEncoder().encode(compatible.join('')), 16);

    return bytes;
}

test('identifies HEIC and HEIF without treating AVIF or a truncated container as HEIC', () => {
    expect(sniffImageMime(ftyp('heic', 'mif1'))).toBe('image/heic');
    expect(sniffImageMime(ftyp('mif1', 'heix'))).toBe('image/heic');
    expect(sniffImageMime(ftyp('mif1'))).toBe('image/heif');
    expect(sniffImageMime(ftyp('avif', 'mif1'))).toBeNull();
    expect(sniffImageMime(ftyp('heic', 'mif1').subarray(0, 19))).toBeNull();
});
