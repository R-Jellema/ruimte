import type { AgentKind } from '@ruimte/contracts';
import { usePetSprites } from '@/canvas/pets/custom-sprites';
import type { PetLook } from '@/canvas/pets/paint';
import { builtInSprite, petChoiceFor, petPoolOf } from '@/canvas/pets/pet-state';
import { useSettings } from '@/state/settings';

/* The look of a node's pet: from the set the settings pool gives that node, a built-in figure for its agent or the strip a person added. */
export function usePetLook(agent: AgentKind | undefined, nodeId: string): PetLook {
    const setting = useSettings((s) => s.petsSets);
    const sprites = usePetSprites((s) => s.sprites);
    const choice = petChoiceFor(
        petPoolOf(
            setting,
            sprites.map((sprite) => sprite.id)
        ),
        nodeId
    );
    const custom = choice.kind === 'custom' ? sprites.find((sprite) => sprite.id === choice.id) : undefined;
    if (custom !== undefined) {
        return { kind: 'sheet', sprite: custom };
    }
    return { kind: 'drawn', sprite: builtInSprite(choice.kind === 'built-in' ? choice.set : 'buddies', agent) };
}
