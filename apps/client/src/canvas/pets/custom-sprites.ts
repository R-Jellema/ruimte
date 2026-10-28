import { create } from 'zustand';
import { z } from 'zod';
import { storedJson } from '@/state/stored-json';

export const PET_SPRITES_STORAGE_KEY = 'ruimte.pets.sprites';

/*
 * The bounds of a sprite a person adds. It lives in this client's storage beside the settings, which
 * every window of the app shares and which holds a few megabytes at most, so a sprite stays small.
 */
export const SHEET_LIMITS = { bytes: 64 * 1024, minFrame: 8, maxFrame: 256, maxFrames: 16, maxSprites: 8, nameLength: 40 } as const;

/* Raster images only: an SVG can carry script and links, and a strip of pixel art needs neither. */
export const SHEET_TYPES = ['image/png', 'image/webp'] as const;

// What a stored image may start with, so a hand-edited key can still only ever hand an <img> a PNG or a WebP.
const DATA_URL = /^data:image\/(png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/* A strip of square frames, left to right, played in a loop. See `README.md` beside this file. */
export interface CustomPetSprite {
    id: string;
    name: string;
    /* The image itself, as a data URL, so nothing is read from disk again. */
    image: string;
    frameSize: number;
    frames: number;
}

export type SheetProblem = 'type' | 'bytes' | 'unreadable' | 'frame-small' | 'frame-large' | 'frames-whole' | 'frames-many' | 'full' | 'storage';

const SpriteSchema = z.object({
    id: z.string().min(1),
    name: z.string(),
    image: z.string().regex(DATA_URL),
    frameSize: z.number().int().min(SHEET_LIMITS.minFrame).max(SHEET_LIMITS.maxFrame),
    frames: z.number().int().min(1).max(SHEET_LIMITS.maxFrames)
});

// One sprite that no longer fits drops out alone, and the others stay.
const storedSprites = storedJson<CustomPetSprite[]>(
    PET_SPRITES_STORAGE_KEY,
    z.array(z.unknown()).transform((entries) => entries.flatMap((entry) => SpriteSchema.safeParse(entry).data ?? []))
);

/*
 * Whether the bytes are the PNG or WebP their type says, read from the signature at the start rather
 * than from the file name, so a renamed SVG or HTML file never gets in.
 */
export function hasImageSignature(dataUrl: string): boolean {
    const match = DATA_URL.exec(dataUrl);
    if (match === null) {
        return false;
    }
    let head: string;
    try {
        head = atob(dataUrl.slice(dataUrl.indexOf(',') + 1, dataUrl.indexOf(',') + 1 + 16));
    } catch {
        return false;
    }
    if (match[1] === 'png') {
        return head.startsWith('\x89PNG\r\n\x1a\n');
    }
    return head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP';
}

/* How a sheet of this size is cut: square frames as high as the image, as many as fit across it. */
export function sheetLayout(width: number, height: number): { frameSize: number; frames: number } | { problem: SheetProblem } {
    if (height < SHEET_LIMITS.minFrame) {
        return { problem: 'frame-small' };
    }
    if (height > SHEET_LIMITS.maxFrame) {
        return { problem: 'frame-large' };
    }
    if (width % height !== 0 || width === 0) {
        return { problem: 'frames-whole' };
    }
    const frames = width / height;
    if (frames > SHEET_LIMITS.maxFrames) {
        return { problem: 'frames-many' };
    }
    return { frameSize: height, frames };
}

/* The name a sprite gets from its file: the file name without its extension, as long as a row shows. */
export function spriteNameOf(fileName: string): string {
    const name = fileName.replace(/\.[^.]+$/, '').trim();
    return (name === '' ? fileName : name).slice(0, SHEET_LIMITS.nameLength);
}

interface PetSpritesStore {
    sprites: CustomPetSprite[];
    /* False when the storage refused it, which keeps nothing. */
    add(sprite: CustomPetSprite): boolean;
    remove(id: string): void;
    /* Reads what another window wrote. */
    reload(): void;
}

export const usePetSprites = create<PetSpritesStore>((set, get) => ({
    sprites: storedSprites.read() ?? [],
    add(sprite) {
        const next = [...get().sprites, sprite];
        if (!storedSprites.write(next)) {
            return false;
        }
        set({ sprites: next });
        return true;
    },
    remove(id) {
        const next = get().sprites.filter((sprite) => sprite.id !== id);
        storedSprites.write(next);
        set({ sprites: next });
    },
    reload() {
        set({ sprites: storedSprites.read() ?? [] });
    }
}));

export interface SheetFile {
    name: string;
    type: string;
    size: number;
}

export interface SheetReader {
    dataUrl(file: SheetFile): Promise<string>;
    size(dataUrl: string): Promise<{ width: number; height: number }>;
}

/*
 * Checks a file a person picked and keeps it. Only the file the system's open panel hands over is read,
 * never a folder, so the feature needs no access to anything else on the computer.
 */
export async function addPetSprite(
    file: SheetFile,
    reader: SheetReader,
    newId: () => string
): Promise<{ sprite: CustomPetSprite } | { problem: SheetProblem }> {
    if (!(SHEET_TYPES as readonly string[]).includes(file.type)) {
        return { problem: 'type' };
    }
    if (file.size > SHEET_LIMITS.bytes) {
        return { problem: 'bytes' };
    }
    if (usePetSprites.getState().sprites.length >= SHEET_LIMITS.maxSprites) {
        return { problem: 'full' };
    }
    let image: string;
    let size: { width: number; height: number };
    try {
        image = await reader.dataUrl(file);
        if (!hasImageSignature(image)) {
            return { problem: 'unreadable' };
        }
        size = await reader.size(image);
    } catch {
        return { problem: 'unreadable' };
    }
    const layout = sheetLayout(size.width, size.height);
    if ('problem' in layout) {
        return layout;
    }
    const sprite: CustomPetSprite = { id: newId(), name: spriteNameOf(file.name), image, ...layout };
    return usePetSprites.getState().add(sprite) ? { sprite } : { problem: 'storage' };
}

/* The browser's own reading of a picked file and of the image in it. */
export const browserSheetReader: SheetReader = {
    dataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('unreadable')));
            reader.onerror = () => reject(reader.error ?? new Error('unreadable'));
            reader.readAsDataURL(file as File);
        });
    },
    async size(dataUrl) {
        const image = new Image();
        image.src = dataUrl;
        await image.decode();
        return { width: image.naturalWidth, height: image.naturalHeight };
    }
};

const images = new Map<string, HTMLImageElement>();

/* The decoded image of a sprite, once per page; null while it still decodes or when the page has no images. */
export function spriteImage(sprite: CustomPetSprite): HTMLImageElement | null {
    if (typeof Image === 'undefined') {
        return null;
    }
    let image = images.get(sprite.id);
    if (image === undefined) {
        image = new Image();
        image.src = sprite.image;
        images.set(sprite.id, image);
    }
    return image.complete && image.naturalWidth > 0 ? image : null;
}
