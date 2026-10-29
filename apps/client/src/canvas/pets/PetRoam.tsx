import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '@adecore/ui';
import { useChats } from '@adecore/agents-react/state';
import { nodeColorOf } from '@ruimte/contracts';
import { accentColor } from '@/canvas/accents';
import { petLabel, usePrefersStill } from '@/canvas/pets/figure-support';
import { PetFigure } from '@/canvas/pets/PetFigure';
import { PET_HEIGHT, PET_HIT_HEIGHT, PET_HIT_TOP, PET_PAINT_WIDTH, PET_WIDTH, petNodeKey, petOf } from '@/canvas/pets/pet-state';
import { PET_LEDGE_ATTRIBUTE, PET_WALL_ATTRIBUTE } from '@/canvas/pets/attributes';
import { groundOf, Roam, type Obstacle } from '@/canvas/pets/roam';
import { onPetTick } from '@/canvas/pets/ticker';
import { usePetLook } from '@/canvas/pets/use-pet-look';
import { PROMPT_STACK_ATTRIBUTE } from '@/canvas/prompt-stack';
import { useCanvas, useCanvasStore } from '@/state/canvas';
import { useEndpointId } from '@/state/keys';
import { useSessions } from '@/state/sessions';
import { useSnoozes } from '@/state/snooze';

function boxOf(element: Element | null | undefined, layer: DOMRect, ledge: boolean): Obstacle | null {
    if (element === null || element === undefined) {
        return null;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
        return null;
    }
    // Whole pixels, so a box that moves by a fraction does not count as a new ground on every beat.
    return {
        left: Math.round(rect.left - layer.left),
        right: Math.round(rect.right - layer.left),
        bottom: Math.round(layer.bottom - rect.bottom),
        top: Math.round(layer.bottom - rect.top),
        ledge
    };
}

/*
 * What stands at the bottom of this canvas's cell. The layer and the cell's own chrome, the dock and the
 * prompt stack, are drawn in the same box that follows the cell (`CellOverlay`), so they are looked up there.
 */
function obstaclesAround(layer: HTMLElement): Obstacle[] {
    const box = layer.getBoundingClientRect();
    const cell = layer.parentElement?.parentElement ?? layer.parentElement;
    if (cell === null) {
        return [];
    }
    // A dock that hides on its own fades out, and while it is gone a pet does not stand on air.
    const bar = cell.querySelector(`[${PET_LEDGE_ATTRIBUTE}]`)?.firstElementChild;
    const shown = bar instanceof HTMLElement && Number.parseFloat(getComputedStyle(bar).opacity) > 0.5;
    const stack = cell.querySelector(`[${PROMPT_STACK_ATTRIBUTE}] > [data-holds-dock]`);
    return [
        shown ? boxOf(bar, box, true) : null,
        boxOf(stack, box, false),
        ...[...cell.querySelectorAll(`[${PET_WALL_ATTRIBUTE}]`)].map((wall) => boxOf(wall, box, false))
    ].filter((obstacle) => obstacle !== null);
}

/* One pet along the bottom, placed on each beat by the layer's `Roam`, which this tells its mood. */
function RoamingPet({ id, roam, onElement }: { id: string; roam: Roam; onElement: (id: string, element: HTMLElement | null) => void }) {
    const { t } = useTranslation('canvas');
    const canvasStore = useCanvasStore();
    const endpointId = useEndpointId();
    const node = useCanvas((s) => s.nodes[id]);
    const sessions = useSessions((s) => s.byKey);
    const chats = useChats((s) => s.statusByKey);
    const snoozes = useSnoozes((s) => s.byKey);
    const pet = node === undefined ? null : petOf(node, sessions, chats, endpointId, snoozes);
    const look = usePetLook(pet?.agent, id);
    const mood = pet?.mood ?? null;

    useEffect(() => {
        if (mood === null) {
            return;
        }
        roam.join(id, mood);
    }, [roam, id, mood]);

    useEffect(() => () => roam.leave(id), [roam, id]);

    if (node === undefined || pet === null) {
        return null;
    }
    const label = petLabel(t, node, pet.mood);
    return (
        <div
            ref={(element) => onElement(id, element)}
            data-pet-roaming={id}
            className="absolute bottom-0 left-0"
            // Out of sight until the layer has placed it, so it never shows in the corner first.
            style={{ width: PET_PAINT_WIDTH, height: PET_HEIGHT, visibility: 'hidden' }}
        >
            {/* Turned around its own middle, so a pet walking left faces left and stays where it stands. */}
            <div style={{ transformOrigin: `${PET_WIDTH / 2}px 0` }}>
                <PetFigure
                    look={look}
                    mood={pet.mood}
                    crowded={false}
                    accent={accentColor(nodeColorOf(node))}
                    walking={() => roam.spot(id)?.walking === true}
                />
            </div>
            <Tooltip label={label}>
                <button
                    type="button"
                    data-pet={id}
                    data-pet-mood={pet.mood}
                    aria-label={label}
                    className="pointer-events-auto absolute left-0 cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    style={{ top: PET_HIT_TOP, width: PET_WIDTH, height: PET_HIT_HEIGHT }}
                    // Drawn over the canvas, which would read a press on a pet as the start of a box or a pan.
                    onPointerDown={(event) => event.stopPropagation()}
                    onDoubleClick={(event) => event.stopPropagation()}
                    onClick={(event) => {
                        event.stopPropagation();
                        canvasStore.getState().goToNode(id);
                    }}
                />
            </Tooltip>
        </div>
    );
}

/*
 * The pets of a canvas along the bottom of its screen instead of on their nodes: they wander about,
 * rest in their own pose, and hop onto the dock and off again. One that waits on you or stopped stays
 * where it is. Over the canvas and under the dock, which keeps every press meant for it.
 */
export function PetRoam() {
    const ids = useCanvas(petNodeKey);
    const layerRef = useRef<HTMLDivElement>(null);
    const [roam] = useState(() => new Roam(Math.random));
    const [elements] = useState(() => new Map<string, HTMLElement>());
    const still = usePrefersStill();

    useEffect(
        () =>
            onPetTick(() => {
                const layer = layerRef.current;
                if (layer === null) {
                    return;
                }
                roam.step(groundOf(layer.clientWidth, obstaclesAround(layer)), still);
                for (const [id, element] of elements) {
                    const spot = roam.spot(id);
                    element.style.visibility = spot === null ? 'hidden' : 'visible';
                    if (spot === null) {
                        continue;
                    }
                    element.style.transform = `translate(${spot.x}px, ${-spot.y}px)`;
                    const figure = element.firstElementChild;
                    if (figure instanceof HTMLElement) {
                        figure.style.transform = spot.facing === -1 ? 'scaleX(-1)' : '';
                    }
                }
            }),
        [roam, elements, still]
    );

    const onElement = (id: string, element: HTMLElement | null): void => {
        if (element === null) {
            elements.delete(id);
            return;
        }
        elements.set(id, element);
    };

    return (
        <div ref={layerRef} data-pet-roam className="pointer-events-none absolute inset-0 overflow-hidden">
            {ids === '' ? null : ids.split('\n').map((id) => <RoamingPet key={id} id={id} roam={roam} onElement={onElement} />)}
        </div>
    );
}
