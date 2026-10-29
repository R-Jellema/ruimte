import { useEffect, useRef } from 'react';
import { usePrefersStill } from '@/canvas/pets/figure-support';
import { KID_HEIGHT, KID_PAINT_WIDTH } from '@/canvas/pets/kids';
import { PAINT_SIZE, paintPet, petPainter, type PetLook } from '@/canvas/pets/paint';
import { PET_HEIGHT, PET_PAINT_WIDTH, type PetMood } from '@/canvas/pets/pet-state';
import { bowColors, type PetPose } from '@/canvas/pets/pixel';
import { onPetTick } from '@/canvas/pets/ticker';

/*
 * A canvas of its own that repaints on the shared beat, so React renders a pet only when its mood or
 * look changes, and the beat paints only a frame that differs from the one before it. A kid (`small`)
 * is the same paint shown at half the size.
 */
export function PetFigure({
    look,
    mood,
    crowded,
    accent,
    walking,
    small = false,
    pose
}: {
    look: PetLook;
    mood: PetMood;
    crowded: boolean;
    accent?: string;
    walking?: () => boolean;
    small?: boolean;
    /* Only for a preview of one state: that pose, whatever the mood. */
    pose?: PetPose;
}) {
    const ref = useRef<HTMLCanvasElement>(null);
    const still = usePrefersStill();
    useEffect(() => {
        const context = ref.current?.getContext('2d') ?? null;
        if (context === null) {
            return;
        }
        const bow = accent === undefined ? null : bowColors(accent);
        return onPetTick(petPainter(look, mood, still, (frame) => paintPet(context, look, frame, crowded, bow), walking, pose));
    }, [look, mood, still, crowded, accent, walking, pose]);
    return (
        <canvas
            ref={ref}
            width={PAINT_SIZE.w}
            height={PAINT_SIZE.h}
            className="block"
            style={{ width: small ? KID_PAINT_WIDTH : PET_PAINT_WIDTH, height: small ? KID_HEIGHT : PET_HEIGHT, imageRendering: 'pixelated' }}
            aria-hidden
        />
    );
}
