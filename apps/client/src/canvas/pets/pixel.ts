import { BUBBLE, PROPS } from '@/canvas/pets/sprite-colors';

/* A rectangle on a pet's grid, in cells. An outlined one gets a rim of one cell in the outline color. */
export interface Cell {
    x: number;
    y: number;
    w: number;
    h: number;
    color: string;
    outlined?: boolean;
}

/*
 * What a pose draws for one frame. The silhouette is outlined in the sprite's own color and filled
 * after every outline, so two parts of one body read as one shape; details go on top without a rim.
 */
export interface Parts {
    silhouette: Cell[];
    details: Cell[];
    props: Cell[];
}

export const PET_POSES = ['stand', 'work', 'wait', 'sleep', 'stopped'] as const;

export type PetPose = (typeof PET_POSES)[number];

/* A pet drawn from rectangles in code. Every built-in pet is one, on a grid of `SPRITE_COLUMNS` by `SPRITE_ROWS`. */
export interface DrawnSprite {
    id: string;
    outline: string;
    poses: Readonly<Record<PetPose, (frame: number) => Parts>>;
}

export const SPRITE_COLUMNS = 26;
export const SPRITE_ROWS = 18;

/* The rows over a pet that its bubble takes, and the rows it may rise into when it jumps. */
export const BUBBLE_ROWS = 9;
export const JUMP_ROWS = 4;

/* The cells the bubble covers, its rim and tail included; the tail reaches two rows into the figure's. */
export const BUBBLE_SIZE = { columns: 12, rows: BUBBLE_ROWS + 2 } as const;

/* The bubble's first column over a pet's head, and beside it: one clear of every built-in figure's wait pose. */
export const BUBBLE_ABOVE = 14;
export const BUBBLE_BESIDE = 20;

/* The grid a pet paints in: its own, with the bubble and the jump above it and room on its right for the bubble beside it. */
export const PAINT_COLUMNS = BUBBLE_BESIDE + BUBBLE_SIZE.columns;
export const PAINT_ROWS = BUBBLE_ROWS + JUMP_ROWS + SPRITE_ROWS;

/* Every pose of a built-in figure repeats after this many frames (its steps are 2, 3, 4 and 6 long), so a frame and the one this far on look the same. */
export const DRAWN_CYCLE = 12;

export function cell(x: number, y: number, w: number, h: number, color: string): Cell {
    return { x, y, w, h, color };
}

export function outlined(x: number, y: number, w: number, h: number, color: string): Cell {
    return { x, y, w, h, color, outlined: true };
}

export function emptyParts(): Parts {
    return { silhouette: [], details: [], props: [] };
}

/* Upside down inside the sprite's grid, then `drop` cells lower: legs in the air. */
export function flipped(parts: Parts, drop: number): Parts {
    const flip = (cells: Cell[]): Cell[] => cells.map((part) => ({ ...part, y: SPRITE_ROWS - part.y - part.h - 1 + drop }));
    return { silhouette: flip(parts.silhouette), details: flip(parts.details), props: flip(parts.props) };
}

/* A cross for an eye that gave up. */
export function crossEye(x: number, y: number, color: string): Cell[] {
    return [
        cell(x - 1, y - 1, 1, 1, color),
        cell(x + 1, y - 1, 1, 1, color),
        cell(x, y, 1, 1, color),
        cell(x - 1, y + 1, 1, 1, color),
        cell(x + 1, y + 1, 1, 1, color)
    ];
}

/* A laptop seen from the side, with code popping out of its screen. */
export function laptop(left: number, frame: number): Cell[] {
    const cells = [
        outlined(left, 14, 7, 2, PROPS.key),
        outlined(left + 6, 8, 1, 7, PROPS.screen),
        cell(left + 5, 9, 1, 5, frame % 3 === 0 ? PROPS.glowBright : PROPS.glow),
        cell(left + 1, 14, 4, 1, PROPS.metal)
    ];
    const step = frame % 6;
    if (step < 3) {
        cells.push(cell(left + 3 - step, 7 - step, 1, 1, PROPS.glow));
    }
    return cells;
}

/* Two letters z rising beside a sleeper. */
export function snore(left: number, frame: number): Cell[] {
    const rise = frame % 2;
    const color = PROPS.sleep;
    return [
        cell(left, 5 + rise, 3, 1, color),
        cell(left + 1, 6 + rise, 1, 1, color),
        cell(left, 7 + rise, 3, 1, color),
        cell(left + 3, rise, 4, 1, color),
        cell(left + 5, 1 + rise, 1, 1, color),
        cell(left + 4, 2 + rise, 1, 1, color),
        cell(left + 3, 3 + rise, 4, 1, color)
    ];
}

/* A small grey cloud over a pet that stopped. */
export function cloud(frame: number): Cell[] {
    const drift = frame % 2;
    return [
        cell(20, 10 - drift, 3, 3, PROPS.cloud),
        cell(19, 11 - drift, 5, 2, PROPS.cloud),
        cell(20, 13 - drift, 3, 1, PROPS.cloudShade),
        cell(23, 8 - drift, 1, 1, PROPS.cloud)
    ];
}

/* The bubble of a pet that waits on you, from its top left cell: black, with an exclamation mark, its tail pointing down at the pet. */
export function bubble(x: number, y: number): Cell[] {
    return [
        cell(x, y + 1, 12, 8, BUBBLE.rim),
        cell(x + 1, y, 10, 10, BUBBLE.rim),
        cell(x + 2, y + 9, 3, 2, BUBBLE.rim),
        cell(x + 1, y + 1, 10, 8, BUBBLE.ground),
        cell(x + 3, y + 9, 1, 1, BUBBLE.ground),
        cell(x + 5, y + 2, 2, 4, BUBBLE.mark),
        cell(x + 5, y + 7, 2, 1, BUBBLE.mark)
    ];
}

export interface PaintTarget {
    fillStyle: string | CanvasGradient | CanvasPattern;
    fillRect(x: number, y: number, w: number, h: number): void;
}

/* Paints parts at a cell offset, `size` pixels a cell. */
export function paintParts(target: PaintTarget, sprite: Pick<DrawnSprite, 'outline'>, parts: Parts, offset: { x: number; y: number }, size: number): void {
    const put = (part: Cell, color: string, grow: number): void => {
        target.fillStyle = color;
        target.fillRect((offset.x + part.x - grow) * size, (offset.y + part.y - grow) * size, (part.w + grow * 2) * size, (part.h + grow * 2) * size);
    };
    for (const part of parts.silhouette) {
        put(part, sprite.outline, 1);
    }
    for (const part of parts.props) {
        if (part.outlined === true) {
            put(part, PROPS.outline, 1);
        }
    }
    for (const part of [...parts.silhouette, ...parts.props, ...parts.details]) {
        put(part, part.color, 0);
    }
}

/* Cells painted as they are, the last on top. */
export function paintCells(target: PaintTarget, cells: readonly Cell[], size: number): void {
    for (const part of cells) {
        target.fillStyle = part.color;
        target.fillRect(part.x * size, part.y * size, part.w * size, part.h * size);
    }
}
