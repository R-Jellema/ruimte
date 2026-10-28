import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
    addPetSprite,
    imageFacts,
    SHEET_LIMITS,
    sheetLayout,
    spriteNameOf,
    storedSpriteOf,
    usePetSprites,
    type SheetReader
} from '@/canvas/pets/custom-sprites';

function bytesOf(...parts: (string | number[])[]): string {
    return parts.map((part) => (typeof part === 'string' ? part : String.fromCharCode(...part))).join('');
}

function bigEndian(value: number): number[] {
    return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
}

function littleEndian(value: number, length: number): number[] {
    return Array.from({ length }, (_, i) => (value >>> (8 * i)) & 255);
}

/* The start of a PNG of this size, padded to `length` bytes: enough for a header to read. */
function png(width: number, height: number, length = 64): string {
    const head = bytesOf('\x89PNG\r\n\x1a\n', bigEndian(13), 'IHDR', bigEndian(width), bigEndian(height), [8, 6, 0, 0, 0]);
    return `data:image/png;base64,${btoa(head.padEnd(length, '\0'))}`;
}

function webpLossless(width: number, height: number): string {
    const bits = (width - 1) | ((height - 1) << 14);
    const head = bytesOf('RIFF', littleEndian(40, 4), 'WEBP', 'VP8L', littleEndian(20, 4), [0x2f], littleEndian(bits, 4));
    return `data:image/webp;base64,${btoa(head.padEnd(48, '\0'))}`;
}

function webpExtended(width: number, height: number): string {
    const head = bytesOf(
        'RIFF',
        littleEndian(40, 4),
        'WEBP',
        'VP8X',
        littleEndian(10, 4),
        [0, 0, 0, 0],
        littleEndian(width - 1, 3),
        littleEndian(height - 1, 3)
    );
    return `data:image/webp;base64,${btoa(head.padEnd(48, '\0'))}`;
}

function webpLossy(width: number, height: number): string {
    const head = bytesOf(
        'RIFF',
        littleEndian(40, 4),
        'WEBP',
        'VP8 ',
        littleEndian(20, 4),
        [0, 0, 0],
        [0x9d, 0x01, 0x2a],
        littleEndian(width, 2),
        littleEndian(height, 2)
    );
    return `data:image/webp;base64,${btoa(head.padEnd(48, '\0'))}`;
}

const STRIP = png(64, 16);

function reader(dataUrl: string, size = { width: 64, height: 16 }): SheetReader {
    return { dataUrl: async () => dataUrl, size: async () => size };
}

const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

// The unit run has no storage of its own, and a sprite the storage refuses is not kept.
beforeEach(() => {
    const items = new Map<string, string>();
    const storage = {
        getItem: (key: string) => items.get(key) ?? null,
        setItem: (key: string, value: string) => void items.set(key, value),
        removeItem: (key: string) => void items.delete(key)
    };
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
});

afterEach(() => {
    for (const sprite of usePetSprites.getState().sprites) {
        usePetSprites.getState().remove(sprite.id);
    }
    if (original === undefined) {
        Reflect.deleteProperty(globalThis, 'localStorage');
    } else {
        Object.defineProperty(globalThis, 'localStorage', original);
    }
});

describe('how a strip is cut', () => {
    test('square frames as high as the image, side by side', () => {
        expect(sheetLayout(64, 16)).toEqual({ frameSize: 16, frames: 4 });
        expect(sheetLayout(32, 32)).toEqual({ frameSize: 32, frames: 1 });
    });

    test('refuses what is no whole number of frames, too small, too large or too long', () => {
        expect(sheetLayout(50, 16)).toEqual({ problem: 'frames-whole' });
        expect(sheetLayout(0, 16)).toEqual({ problem: 'frames-whole' });
        expect(sheetLayout(16, 4)).toEqual({ problem: 'frame-small' });
        expect(sheetLayout(512, 512)).toEqual({ problem: 'frame-large' });
        expect(sheetLayout(16 * (SHEET_LIMITS.maxFrames + 1), 16)).toEqual({ problem: 'frames-many' });
    });
});

describe('what the bytes of an image say', () => {
    test('a PNG and the three kinds of WebP give their type, length and size', () => {
        expect(imageFacts(STRIP)).toEqual({ type: 'png', bytes: 64, width: 64, height: 16 });
        expect(imageFacts(webpLossless(48, 16))).toMatchObject({ type: 'webp', width: 48, height: 16 });
        expect(imageFacts(webpExtended(300, 20))).toMatchObject({ type: 'webp', width: 300, height: 20 });
        expect(imageFacts(webpLossy(32, 32))).toMatchObject({ type: 'webp', width: 32, height: 32 });
    });

    test('nothing for an SVG, an HTML file with a PNG type, or a header that does not read', () => {
        expect(imageFacts(`data:image/png;base64,${btoa('<svg onload="x()"></svg>')}`)).toBeNull();
        expect(imageFacts(`data:image/png;base64,${btoa('<html><script></script></html>')}`)).toBeNull();
        expect(imageFacts(`data:image/svg+xml;base64,${STRIP.slice(STRIP.indexOf(',') + 1)}`)).toBeNull();
        expect(imageFacts(`data:image/png;base64,${btoa('\x89PNG\r\n\x1a\n')}`)).toBeNull();
        expect(imageFacts('../../etc/passwd')).toBeNull();
    });
});

describe('a picked file', () => {
    test('is kept under its name, and becomes a choice another window reads back', async () => {
        const result = await addPetSprite({ name: 'cat.png', type: 'image/png', size: 900 }, reader(STRIP), () => 'c1');
        expect(result).toEqual({ sprite: { id: 'c1', name: 'cat', image: STRIP, frameSize: 16, frames: 4 } });
        expect(usePetSprites.getState().sprites.map((sprite) => sprite.id)).toEqual(['c1']);
        usePetSprites.setState({ sprites: [] });
        usePetSprites.getState().reload();
        expect(usePetSprites.getState().sprites.map((sprite) => sprite.name)).toEqual(['cat']);
    });

    test('a sprite the storage refuses is not kept, since it would be gone after a reload', async () => {
        Reflect.deleteProperty(globalThis, 'localStorage');
        expect(await addPetSprite({ name: 'cat.png', type: 'image/png', size: 900 }, reader(STRIP), () => 'c1')).toEqual({ problem: 'storage' });
        expect(usePetSprites.getState().sprites).toEqual([]);
    });

    test('is refused when it is an SVG, too large, not an image, cut wrong or decodes to another size, and nothing is kept', async () => {
        const file = { name: 'cat.png', type: 'image/png', size: 900 };
        expect(await addPetSprite({ ...file, type: 'image/svg+xml' }, reader(STRIP), () => 'x')).toEqual({ problem: 'type' });
        expect(await addPetSprite({ ...file, size: SHEET_LIMITS.bytes + 1 }, reader(STRIP), () => 'x')).toEqual({ problem: 'bytes' });
        expect(await addPetSprite(file, reader(png(64, 16, SHEET_LIMITS.bytes + 3)), () => 'x')).toEqual({ problem: 'bytes' });
        expect(await addPetSprite(file, reader(`data:image/png;base64,${btoa('<html>')}`), () => 'x')).toEqual({ problem: 'unreadable' });
        expect(await addPetSprite(file, reader(png(50, 16), { width: 50, height: 16 }), () => 'x')).toEqual({ problem: 'frames-whole' });
        expect(await addPetSprite(file, reader(STRIP, { width: 32, height: 16 }), () => 'x')).toEqual({ problem: 'unreadable' });
        expect(usePetSprites.getState().sprites).toEqual([]);
    });

    test('is refused once the client keeps as many as it may', async () => {
        for (let i = 0; i < SHEET_LIMITS.maxSprites; i++) {
            await addPetSprite({ name: `cat${i}.png`, type: 'image/png', size: 900 }, reader(STRIP), () => `c${i}`);
        }
        expect(await addPetSprite({ name: 'one.png', type: 'image/png', size: 900 }, reader(STRIP), () => 'more')).toEqual({ problem: 'full' });
    });

    test('is named after its file, without the extension and never too long', () => {
        expect(spriteNameOf('my cat.png')).toBe('my cat');
        expect(spriteNameOf('.png')).toBe('.png');
        expect(spriteNameOf(`${'a'.repeat(60)}.png`)).toHaveLength(SHEET_LIMITS.nameLength);
    });
});

describe('a sprite read back from storage', () => {
    const good = { id: 'ok', name: 'ok', image: STRIP, frameSize: 16, frames: 4 };

    test('passes only as an import would take it now', () => {
        expect(storedSpriteOf(good)).toEqual(good);
        expect(storedSpriteOf({ ...good, image: webpLossless(32, 16), frames: 2 })).toEqual({ ...good, image: webpLossless(32, 16), frames: 2 });
    });

    test('drops other bytes behind a PNG type', () => {
        expect(storedSpriteOf({ ...good, image: `data:image/png;base64,${btoa('<svg onload="x()"></svg>')}` })).toBeNull();
    });

    test('drops a type that is no PNG or WebP, and anything that is no data URL', () => {
        expect(storedSpriteOf({ ...good, image: 'data:image/svg+xml;base64,PHN2Zz4=' })).toBeNull();
        expect(storedSpriteOf({ ...good, image: '../../etc/passwd' })).toBeNull();
    });

    test('drops an image over the byte limit', () => {
        expect(storedSpriteOf({ ...good, image: png(64, 16, SHEET_LIMITS.bytes + 3) })).toBeNull();
    });

    test('drops a sprite whose image is not cut the way it says', () => {
        expect(storedSpriteOf({ ...good, frames: 2 })).toBeNull();
        expect(storedSpriteOf({ ...good, frameSize: 32 })).toBeNull();
    });

    test('drops an image whose own size is outside the limits, whatever is stored beside it', () => {
        expect(storedSpriteOf({ ...good, image: png(4096, 256 * 2), frameSize: 16, frames: 4 })).toBeNull();
        expect(storedSpriteOf({ ...good, image: png(16 * 20, 16), frames: 4 })).toBeNull();
        expect(storedSpriteOf({ ...good, image: png(4, 4), frameSize: 16, frames: 4 })).toBeNull();
    });

    test('keeps the ones that pass and drops the rest of a hand-edited key', () => {
        localStorage.setItem(
            'ruimte.pets.sprites',
            JSON.stringify([
                good,
                { ...good, id: 'liar', frames: 1 },
                { ...good, id: 'big', image: png(64, 16, SHEET_LIMITS.bytes + 3) },
                { id: 'path', image: '../x' }
            ])
        );
        usePetSprites.getState().reload();
        expect(usePetSprites.getState().sprites.map((sprite) => sprite.id)).toEqual(['ok']);
    });
});
