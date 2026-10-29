import { useEffect, useState, type CSSProperties } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '@adecore/ui';
import { useChats } from '@adecore/agents-react/state';
import { nodeColorOf } from '@ruimte/contracts';
import { accentColor } from '@/canvas/accents';
import { useNodeInViewport } from '@/canvas/culling';
import { visibleRect } from '@/canvas/math';
import { petLabel } from '@/canvas/pets/figure-support';
import { PetFigure } from '@/canvas/pets/PetFigure';
import {
    PET_HEIGHT,
    PET_HIT_HEIGHT,
    PET_HIT_TOP,
    PET_PAINT_WIDTH,
    PET_WIDTH,
    petBlocked,
    petCrowded,
    petNodeKey,
    petOf,
    petPlace
} from '@/canvas/pets/pet-state';
import { usePetLook } from '@/canvas/pets/use-pet-look';
import { createVisitor, VISIT_MS, visitSpot, type VisitSpot } from '@/canvas/pets/visitor';
import { maximizedNodeOf, useCanvas, useCanvasStore } from '@/state/canvas';
import { useEndpointId } from '@/state/keys';
import { useSessions } from '@/state/sessions';
import { useSettings } from '@/state/settings';
import { useSnoozes } from '@/state/snooze';

const visitor = createVisitor({
    setTimeout: (run, ms) => window.setTimeout(run, ms),
    clearTimeout: (handle) => window.clearTimeout(handle as number),
    random: Math.random
});

/*
 * A pet on its node, when an agent is in it. Only its figure takes a press, and not even that where the
 * figure stands on another node (`blocked`) or while a line is being aimed, so a press on that node, or
 * on the canvas for the line, still lands there. The bubble is paint and never takes one; where a node
 * lies over the pet's head (`crowded`) it goes beside the pet, so it never covers that node.
 */
function Pet({ id }: { id: string }) {
    const { t } = useTranslation('canvas');
    const canvasStore = useCanvasStore();
    const endpointId = useEndpointId();
    const node = useCanvas((s) => s.nodes[id]);
    const blocked = useCanvas((s) => petBlocked(s, id));
    const crowded = useCanvas((s) => petCrowded(s, id));
    const aiming = useCanvas((s) => s.linkDraft?.aiming === true);
    const sessions = useSessions((s) => s.byKey);
    const chats = useChats((s) => s.statusByKey);
    const snoozes = useSnoozes((s) => s.byKey);
    const pet = node === undefined ? null : petOf(node, sessions, chats, endpointId, snoozes);
    const look = usePetLook(pet?.agent, id);
    // A pet off screen keeps no beat; it stands where it was once its node comes back in view.
    const inView = useNodeInViewport(id);
    if (node === undefined || pet === null) {
        return null;
    }
    const { mood } = pet;
    const place = petPlace(node);
    const label = petLabel(t, node, mood);
    return (
        <div className="absolute" style={{ left: place.x, top: place.y, width: PET_PAINT_WIDTH, height: PET_HEIGHT }}>
            {inView && <PetFigure look={look} mood={mood} crowded={crowded} accent={accentColor(nodeColorOf(node))} />}
            <Tooltip label={label}>
                <button
                    type="button"
                    data-pet={id}
                    data-pet-mood={mood}
                    data-pet-blocked={blocked || undefined}
                    aria-label={label}
                    className={clsx(
                        'absolute left-0 cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent',
                        blocked || aiming ? 'pointer-events-none' : 'pointer-events-auto'
                    )}
                    style={{ top: PET_HIT_TOP, width: PET_WIDTH, height: PET_HIT_HEIGHT }}
                    // A press on a pet is not the start of a box or a pan on the canvas under it.
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

function NodePets() {
    const ids = useCanvas(petNodeKey);
    return ids === '' ? null : ids.split('\n').map((id) => <Pet key={id} id={id} />);
}

/* Now and then, while Pets is off, a pet stands beside a node for a moment and goes again. It takes no press and asks nothing. */
function PetVisitor() {
    const canvasStore = useCanvasStore();
    const [visit, setVisit] = useState<VisitSpot | null>(null);
    // From the set the node it visits would have, so a visitor is one of the figures a person picked.
    const look = usePetLook(undefined, visit?.nodeId ?? '');

    useEffect(() => {
        let leave: ReturnType<typeof setTimeout> | null = null;
        const stop = visitor.host(() => {
            const state = canvasStore.getState();
            if (document.visibilityState !== 'visible' || state.gesturing || maximizedNodeOf(state) !== null) {
                return false;
            }
            const spot = visitSpot(state.nodes, state.hidden, visibleRect(state.camera, state.viewport), Math.random);
            if (spot === null) {
                return false;
            }
            setVisit(spot);
            leave = setTimeout(() => setVisit(null), VISIT_MS);
            return true;
        });
        return () => {
            stop();
            if (leave !== null) {
                clearTimeout(leave);
            }
        };
    }, [canvasStore]);

    if (visit === null) {
        return null;
    }
    return (
        <div
            data-pet-visitor={visit.nodeId}
            className="pet-visitor"
            // The fade runs over the visit, so the figure is gone when the visit ends.
            style={{ left: visit.x, top: visit.y, '--pet-visit-duration': `${VISIT_MS}ms` } as CSSProperties}
            aria-hidden
        >
            <PetFigure look={look} mood="visiting" crowded={false} />
        </div>
    );
}

/* The pets of a canvas, in its world so they pan and zoom with their nodes, over every node. */
export function PetLayer({ z }: { z: number }) {
    const pets = useSettings((s) => s.pets);
    const visitorOn = useSettings((s) => s.petsVisitor);
    // Along the bottom of the screen they are `PetRoam`'s, over the canvas rather than in its world.
    const onNodes = useSettings((s) => s.petsPlace === 'nodes');
    return (
        <div className="pointer-events-none absolute left-0 top-0" style={{ zIndex: z }}>
            {pets ? onNodes && <NodePets /> : visitorOn && <PetVisitor />}
        </div>
    );
}
