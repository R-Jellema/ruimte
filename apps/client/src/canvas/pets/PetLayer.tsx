import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '@adecore/ui';
import { useChats } from '@adecore/agents-react/state';
import { useNodeInViewport } from '@/canvas/culling';
import { visibleRect } from '@/canvas/math';
import { PAINT_SIZE, paintPet, petPainter, type PetLook } from '@/canvas/pets/paint';
import { PET_HEIGHT, PET_HIT_HEIGHT, PET_WIDTH, petPlace, petsOf, type PetMood } from '@/canvas/pets/pet-state';
import { onPetTick } from '@/canvas/pets/ticker';
import { usePetLook } from '@/canvas/pets/use-pet-look';
import { createVisitor, VISIT_MS, visitSpot, type VisitSpot } from '@/canvas/pets/visitor';
import { maximizedNodeOf, useCanvas, useCanvasStore } from '@/state/canvas';
import { useEndpointId } from '@/state/keys';
import { useSessions } from '@/state/sessions';
import { useSettings } from '@/state/settings';
import { useSnoozes } from '@/state/snooze';
import type { AgentKind } from '@ruimte/contracts';

const visitor = createVisitor({
    setTimeout: (run, ms) => window.setTimeout(run, ms),
    clearTimeout: (handle) => window.clearTimeout(handle as number),
    random: Math.random
});

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function prefersStill(): boolean {
    return typeof matchMedia === 'function' && matchMedia(REDUCED_MOTION).matches;
}

function followMotion(onChange: () => void): () => void {
    if (typeof matchMedia !== 'function') {
        return () => {};
    }
    const query = matchMedia(REDUCED_MOTION);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
}

/*
 * A canvas of its own that repaints on the shared beat, so React renders a pet only when its mood or
 * look changes, and the beat paints only a frame that differs from the one before it.
 */
function PetFigure({ look, mood }: { look: PetLook; mood: PetMood }) {
    const ref = useRef<HTMLCanvasElement>(null);
    // Read again when a person turns reduced motion on or off, so the figures stop or move at once.
    const still = useSyncExternalStore(followMotion, prefersStill, () => false);
    useEffect(() => {
        const context = ref.current?.getContext('2d') ?? null;
        if (context === null) {
            return;
        }
        return onPetTick(petPainter(look, mood, still, (frame) => paintPet(context, look, frame)));
    }, [look, mood, still]);
    return (
        <canvas
            ref={ref}
            width={PAINT_SIZE.w}
            height={PAINT_SIZE.h}
            className="block"
            style={{ width: PET_WIDTH, height: PET_HEIGHT, imageRendering: 'pixelated' }}
            aria-hidden
        />
    );
}

/*
 * A pet on its node. Only its figure at rest takes a press, and not even that where the figure stands on
 * another node (`blocked`) or while a line is being aimed, so a press on that node, or on the canvas for
 * the line, still lands there. The bubble and the jump above it are paint and never take one.
 */
function Pet({ id, agent, mood, blocked }: { id: string; agent: AgentKind | undefined; mood: PetMood; blocked: boolean }) {
    const { t } = useTranslation('canvas');
    const canvasStore = useCanvasStore();
    const node = useCanvas((s) => s.nodes[id]);
    const aiming = useCanvas((s) => s.linkDraft?.aiming === true);
    const look = usePetLook(agent);
    // A pet off screen keeps no beat; it stands where it was once its node comes back in view.
    const inView = useNodeInViewport(id);
    if (node === undefined) {
        return null;
    }
    const place = petPlace(node);
    // A node a person never named reads as its kind, so the label always says which node it leads to.
    const title = node.title?.trim() || t(node.kind === 'chat' ? 'kinds.chat' : 'kinds.terminal');
    const label = t(mood === 'waiting' || mood === 'snoozed' ? 'pets.waiting' : 'pets.goTo', { title });
    return (
        <div className="absolute" style={{ left: place.x, top: place.y, width: PET_WIDTH, height: PET_HEIGHT }}>
            {inView && <PetFigure look={look} mood={mood} />}
            <Tooltip label={label}>
                <button
                    type="button"
                    data-pet={id}
                    data-pet-mood={mood}
                    data-pet-blocked={blocked || undefined}
                    aria-label={label}
                    className={clsx(
                        'absolute bottom-0 left-0 cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent',
                        blocked || aiming ? 'pointer-events-none' : 'pointer-events-auto'
                    )}
                    style={{ width: PET_WIDTH, height: PET_HIT_HEIGHT }}
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
    const endpointId = useEndpointId();
    const nodes = useCanvas((s) => s.nodes);
    const hidden = useCanvas((s) => s.hidden);
    const sessions = useSessions((s) => s.byKey);
    const chats = useChats((s) => s.statusByKey);
    const snoozes = useSnoozes((s) => s.byKey);
    return petsOf(nodes, hidden, sessions, chats, endpointId, snoozes).map((pet) => (
        <Pet key={pet.id} id={pet.id} agent={pet.agent} mood={pet.mood} blocked={pet.blocked} />
    ));
}

/* Now and then, while Pets is off, a pet stands beside a node for a moment and goes again. It takes no press and asks nothing. */
function PetVisitor() {
    const canvasStore = useCanvasStore();
    const [visit, setVisit] = useState<VisitSpot | null>(null);
    const look = usePetLook(undefined);

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
        <div data-pet-visitor={visit.nodeId} className="pet-visitor" style={{ left: visit.x, top: visit.y }} aria-hidden>
            <PetFigure look={look} mood="visiting" />
        </div>
    );
}

/* The pets of a canvas, in its world so they pan and zoom with their nodes, over every node. */
export function PetLayer({ z }: { z: number }) {
    const pets = useSettings((s) => s.pets);
    const visitorOn = useSettings((s) => s.petsVisitor);
    return (
        <div className="pointer-events-none absolute left-0 top-0" style={{ zIndex: z }}>
            {pets ? <NodePets /> : visitorOn && <PetVisitor />}
        </div>
    );
}
