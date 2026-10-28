import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { addPetSprite, hasImageSignature, SHEET_LIMITS, sheetLayout, spriteNameOf, usePetSprites, type SheetReader } from '@/canvas/pets/custom-sprites';

const PNG_HEAD = btoa('\x89PNG\r\n\x1a\n\0\0\0\rIHD');
const PNG = `data:image/png;base64,${PNG_HEAD}AAAA`;
const WEBP = `data:image/webp;base64,${btoa('RIFF\0\0\0\0WEBPVP8 ')}`;

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

describe('a picked file', () => {
    test('is a PNG or a WebP by its bytes, not by its name', () => {
        expect(hasImageSignature(PNG)).toBe(true);
        expect(hasImageSignature(WEBP)).toBe(true);
        expect(hasImageSignature(`data:image/png;base64,${btoa('<svg onload="x()">')}`)).toBe(false);
        expect(hasImageSignature(`data:image/svg+xml;base64,${PNG_HEAD}`)).toBe(false);
    });

    test('is kept under its name, and becomes a choice', async () => {
        const result = await addPetSprite({ name: 'cat.png', type: 'image/png', size: 900 }, reader(PNG), () => 'c1');
        expect(result).toEqual({ sprite: { id: 'c1', name: 'cat', image: PNG, frameSize: 16, frames: 4 } });
        expect(usePetSprites.getState().sprites.map((sprite) => sprite.id)).toEqual(['c1']);
        // Another window reads the same sprite back from the shared storage.
        usePetSprites.setState({ sprites: [] });
        usePetSprites.getState().reload();
        expect(usePetSprites.getState().sprites.map((sprite) => sprite.name)).toEqual(['cat']);
    });

    test('a sprite the storage refuses is not kept, since it would be gone after a reload', async () => {
        Reflect.deleteProperty(globalThis, 'localStorage');
        expect(await addPetSprite({ name: 'cat.png', type: 'image/png', size: 900 }, reader(PNG), () => 'c1')).toEqual({ problem: 'storage' });
        expect(usePetSprites.getState().sprites).toEqual([]);
    });

    test('what a hand-edited storage holds is read only as a PNG or a WebP', () => {
        localStorage.setItem(
            'ruimte.pets.sprites',
            JSON.stringify([
                { id: 'ok', name: 'ok', image: PNG, frameSize: 16, frames: 1 },
                { id: 'svg', name: 'svg', image: 'data:image/svg+xml;base64,PHN2Zz4=', frameSize: 16, frames: 1 },
                { id: 'path', name: 'path', image: '../../etc/passwd', frameSize: 16, frames: 1 }
            ])
        );
        usePetSprites.getState().reload();
        expect(usePetSprites.getState().sprites.map((sprite) => sprite.id)).toEqual(['ok']);
    });

    test('is refused when it is an SVG, too large, not an image or cut wrong, and nothing is kept', async () => {
        const file = { name: 'cat.png', type: 'image/png', size: 900 };
        expect(await addPetSprite({ ...file, type: 'image/svg+xml' }, reader(PNG), () => 'x')).toEqual({ problem: 'type' });
        expect(await addPetSprite({ ...file, size: SHEET_LIMITS.bytes + 1 }, reader(PNG), () => 'x')).toEqual({ problem: 'bytes' });
        expect(await addPetSprite(file, reader(`data:image/png;base64,${btoa('<html>')}`), () => 'x')).toEqual({ problem: 'unreadable' });
        expect(await addPetSprite(file, reader(PNG, { width: 50, height: 16 }), () => 'x')).toEqual({ problem: 'frames-whole' });
        expect(usePetSprites.getState().sprites).toEqual([]);
    });

    test('is refused once the client keeps as many as it may', async () => {
        for (let i = 0; i < SHEET_LIMITS.maxSprites; i++) {
            await addPetSprite({ name: `cat${i}.png`, type: 'image/png', size: 900 }, reader(PNG), () => `c${i}`);
        }
        expect(await addPetSprite({ name: 'one.png', type: 'image/png', size: 900 }, reader(PNG), () => 'more')).toEqual({ problem: 'full' });
    });

    test('is named after its file, without the extension and never too long', () => {
        expect(spriteNameOf('my cat.png')).toBe('my cat');
        expect(spriteNameOf('.png')).toBe('.png');
        expect(spriteNameOf(`${'a'.repeat(60)}.png`)).toHaveLength(SHEET_LIMITS.nameLength);
    });
});
