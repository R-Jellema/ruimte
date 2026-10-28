import { create } from 'zustand';
import { z } from 'zod';
import { onPetSpritesChanged, PET_SPRITES_STORAGE_KEY } from '@/canvas/pets/sprites-key';
import { storedJson } from '@/state/stored-json';

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

/* What the bytes of an image say about it, read from its own header rather than from its name or what was stored beside it. */
export interface ImageFacts {
    type: 'png' | 'webp';
    bytes: number;
    width: number;
    height: number;
}

// The header of a PNG ends its size at byte 24, of a WebP at byte 30: forty characters of base64 hold both.
const HEAD_CHARACTERS = 40;

function little(head: string, at: number, length: number): number {
    let value = 0;
    for (let i = length - 1; i >= 0; i--) {
        value = value * 256 + head.charCodeAt(at + i);
    }
    return value;
}

function big(head: string, at: number): number {
    return little([...head.slice(at, at + 4)].reverse().join(''), 0, 4);
}

/*
 * The type, length and size of the image in a data URL, from its signature and its header, so a renamed
 * SVG or HTML file never gets in and a stored size cannot claim what the bytes are not. Null for
 * anything that is not a PNG or a WebP whose header reads.
 */
export function imageFacts(dataUrl: string): ImageFacts | null {
    const match = DATA_URL.exec(dataUrl);
    if (match === null) {
        return null;
    }
    const payload = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const bytes = (payload.length / 4) * 3 - (payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0);
    let head: string;
    try {
        head = atob(payload.slice(0, Math.min(payload.length, HEAD_CHARACTERS)));
    } catch {
        return null;
    }
    if (match[1] === 'png') {
        if (!head.startsWith('\x89PNG\r\n\x1a\n') || head.slice(12, 16) !== 'IHDR' || head.length < 24) {
            return null;
        }
        return { type: 'png', bytes, width: big(head, 16), height: big(head, 20) };
    }
    if (!head.startsWith('RIFF') || head.slice(8, 12) !== 'WEBP' || head.length < 30) {
        return null;
    }
    const chunk = head.slice(12, 16);
    if (chunk === 'VP8X') {
        return { type: 'webp', bytes, width: little(head, 24, 3) + 1, height: little(head, 27, 3) + 1 };
    }
    if (chunk === 'VP8L' && head.charCodeAt(20) === 0x2f) {
        const bits = little(head, 21, 4);
        return { type: 'webp', bytes, width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8 ' && head.slice(23, 26) === '\x9d\x01\x2a') {
        return { type: 'webp', bytes, width: little(head, 26, 2) & 0x3fff, height: little(head, 28, 2) & 0x3fff };
    }
    return null;
}

/*
 * A stored sprite only when it is one an import would take now: a PNG or a WebP by its bytes, within the
 * byte limit, and cut the way it says it is. A hand-edited key gets nothing past this to an `<img>`.
 */
export function storedSpriteOf(entry: unknown): CustomPetSprite | null {
    const sprite = SpriteSchema.safeParse(entry).data;
    const facts = sprite === undefined ? null : imageFacts(sprite.image);
    if (sprite === undefined || facts === null || facts.bytes > SHEET_LIMITS.bytes) {
        return null;
    }
    const layout = sheetLayout(facts.width, facts.height);
    if ('problem' in layout || layout.frameSize !== sprite.frameSize || layout.frames !== sprite.frames) {
        return null;
    }
    return sprite;
}

// One sprite that no longer passes drops out alone, and the others stay.
const storedSprites = storedJson<CustomPetSprite[]>(
    PET_SPRITES_STORAGE_KEY,
    z.array(z.unknown()).transform((entries) => entries.flatMap((entry) => storedSpriteOf(entry) ?? []))
);

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
        forgetImages(next);
        set({ sprites: next });
    },
    reload() {
        const next = storedSprites.read() ?? [];
        forgetImages(next);
        set({ sprites: next });
    }
}));

onPetSpritesChanged(() => usePetSprites.getState().reload());

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
    if (keepsNoMore()) {
        return { problem: 'full' };
    }
    let image: string;
    let facts: ImageFacts | null;
    try {
        image = await reader.dataUrl(file);
        facts = imageFacts(image);
    } catch {
        return { problem: 'unreadable' };
    }
    if (facts === null) {
        return { problem: 'unreadable' };
    }
    if (facts.bytes > SHEET_LIMITS.bytes) {
        return { problem: 'bytes' };
    }
    // The size in the header is checked before anything decodes, so a small file that claims a huge image is never drawn out.
    const layout = sheetLayout(facts.width, facts.height);
    if ('problem' in layout) {
        return layout;
    }
    try {
        // The browser decodes it too, so a header that lies about the rest of the file is caught here.
        const decoded = await reader.size(image);
        if (decoded.width !== facts.width || decoded.height !== facts.height) {
            return { problem: 'unreadable' };
        }
    } catch {
        return { problem: 'unreadable' };
    }
    // Asked again, since another window, or a second pick in this one, may have taken the last place while this file was read.
    if (keepsNoMore()) {
        return { problem: 'full' };
    }
    const sprite: CustomPetSprite = { id: newId(), name: spriteNameOf(file.name), image, ...layout };
    return usePetSprites.getState().add(sprite) ? { sprite } : { problem: 'storage' };
}

function keepsNoMore(): boolean {
    return usePetSprites.getState().sprites.length >= SHEET_LIMITS.maxSprites;
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

/* Lets go of the images of sprites that went, and of one whose image another window replaced. */
function forgetImages(kept: readonly CustomPetSprite[]): void {
    for (const [id, image] of images) {
        if (!kept.some((sprite) => sprite.id === id && sprite.image === image.src)) {
            images.delete(id);
        }
    }
}

/*
 * The decoded image of a sprite, once per page for each image it had; null while it still decodes, when
 * what decoded is not the size the sprite says, or when the page has no images.
 */
export function spriteImage(sprite: CustomPetSprite): HTMLImageElement | null {
    if (typeof Image === 'undefined') {
        return null;
    }
    let image = images.get(sprite.id);
    if (image === undefined || image.src !== sprite.image) {
        image = new Image();
        image.src = sprite.image;
        images.set(sprite.id, image);
    }
    const fits = image.naturalWidth === sprite.frameSize * sprite.frames && image.naturalHeight === sprite.frameSize;
    return image.complete && fits ? image : null;
}
