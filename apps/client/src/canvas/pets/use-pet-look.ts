import type { AgentKind } from '@ruimte/contracts';
import { usePetSprites } from '@/canvas/pets/custom-sprites';
import type { PetLook } from '@/canvas/pets/paint';
import { builtInSprite, petChoiceOf } from '@/canvas/pets/pet-state';
import { useSettings } from '@/state/settings';

/* The look the settings name for an agent: a built-in figure, or the strip a person added. */
export function usePetLook(agent: AgentKind | undefined): PetLook {
    const setting = useSettings((s) => s.petsSprite);
    const sprites = usePetSprites((s) => s.sprites);
    const choice = petChoiceOf(
        setting,
        sprites.map((sprite) => sprite.id)
    );
    const custom = choice.kind === 'custom' ? sprites.find((sprite) => sprite.id === choice.id) : undefined;
    if (custom !== undefined) {
        return { kind: 'sheet', sprite: custom };
    }
    return { kind: 'drawn', sprite: builtInSprite(choice.kind === 'built-in' ? choice.set : 'buddies', agent) };
}
