import { useEffect, useRef } from 'react';
import { usePrefersStill } from '@/canvas/pets/figure-support';
import { PAINT_SIZE, paintPet, petPainter, type PetLook } from '@/canvas/pets/paint';
import { PET_HEIGHT, PET_PAINT_WIDTH, type PetMood } from '@/canvas/pets/pet-state';
import { bowColors } from '@/canvas/pets/pixel';
import { onPetTick } from '@/canvas/pets/ticker';

/*
 * A canvas of its own that repaints on the shared beat, so React renders a pet only when its mood or
 * look changes, and the beat paints only a frame that differs from the one before it.
 */
export function PetFigure({
    look,
    mood,
    crowded,
    accent,
    walking
}: {
    look: PetLook;
    mood: PetMood;
    crowded: boolean;
    accent?: string;
    walking?: () => boolean;
}) {
    const ref = useRef<HTMLCanvasElement>(null);
    const still = usePrefersStill();
    useEffect(() => {
        const context = ref.current?.getContext('2d') ?? null;
        if (context === null) {
            return;
        }
        const bow = accent === undefined ? null : bowColors(accent);
        return onPetTick(petPainter(look, mood, still, (frame) => paintPet(context, look, frame, crowded, bow), walking));
    }, [look, mood, still, crowded, accent, walking]);
    return (
        <canvas
            ref={ref}
            width={PAINT_SIZE.w}
            height={PAINT_SIZE.h}
            className="block"
            style={{ width: PET_PAINT_WIDTH, height: PET_HEIGHT, imageRendering: 'pixelated' }}
            aria-hidden
        />
    );
}
