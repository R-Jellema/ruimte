import { spriteImage, type CustomPetSprite } from '@/canvas/pets/custom-sprites';
import type { PetFrame } from '@/canvas/pets/pet-state';
import {
    BUBBLE_ROWS,
    bubble,
    JUMP_ROWS,
    PAINT_COLUMNS,
    PAINT_ROWS,
    paintCells,
    paintParts,
    SPRITE_COLUMNS,
    SPRITE_ROWS,
    type DrawnSprite
} from '@/canvas/pets/pixel';

/* A built-in figure, or a strip a person added. */
export type PetLook = { kind: 'drawn'; sprite: DrawnSprite } | { kind: 'sheet'; sprite: CustomPetSprite };

/* Backing pixels a cell takes, twice the world's, so a pet stays sharp at twice the zoom. */
export const PAINT_CELL = 4;

export const PAINT_SIZE = { w: PAINT_COLUMNS * PAINT_CELL, h: PAINT_ROWS * PAINT_CELL } as const;

// The sprite stands on the bottom of the paint, the jump and the bubble above it.
const GROUND = BUBBLE_ROWS + JUMP_ROWS;

/* A strip's frame is square and as high as a built-in figure, in the middle of its width. */
const SHEET_CELLS = SPRITE_ROWS;
const SHEET_LEFT = (SPRITE_COLUMNS - SHEET_CELLS) / 2;

/* One frame of a pet, with its bubble when it waits on you. */
export function paintPet(context: CanvasRenderingContext2D, look: PetLook, frame: PetFrame): void {
    context.clearRect(0, 0, PAINT_SIZE.w, PAINT_SIZE.h);
    const top = GROUND - frame.lift;
    if (look.kind === 'drawn') {
        paintParts(context, look.sprite, look.sprite.poses[frame.pose](frame.frame), { x: 0, y: top }, PAINT_CELL);
    } else {
        paintSheet(context, look.sprite, frame, top);
    }
    if (frame.bubble) {
        paintCells(context, bubble(top - BUBBLE_ROWS + 1), PAINT_CELL);
    }
}

/* A strip has no poses, so a stopped agent tips its figure over and fades it, and the rest only changes the pace. */
function paintSheet(context: CanvasRenderingContext2D, sprite: CustomPetSprite, frame: PetFrame, top: number): void {
    const image = spriteImage(sprite);
    if (image === null) {
        return;
    }
    const size = SHEET_CELLS * PAINT_CELL;
    const left = SHEET_LEFT * PAINT_CELL;
    const y = top * PAINT_CELL;
    const source = (frame.frame % sprite.frames) * sprite.frameSize;
    context.imageSmoothingEnabled = false;
    if (frame.pose !== 'stopped') {
        context.drawImage(image, source, 0, sprite.frameSize, sprite.frameSize, left, y, size, size);
        return;
    }
    context.save();
    context.globalAlpha = 0.6;
    context.translate(left + size / 2, y + size / 2);
    context.rotate(Math.PI / 2);
    context.drawImage(image, source, 0, sprite.frameSize, sprite.frameSize, -size / 2, -size / 2, size, size);
    context.restore();
}
