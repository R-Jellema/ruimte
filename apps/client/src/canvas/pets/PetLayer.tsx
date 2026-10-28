import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '@adecore/ui';
import { useChats } from '@adecore/agents-react/state';
import { useNodeInViewport } from '@/canvas/culling';
import { visibleRect } from '@/canvas/math';
import { PAINT_SIZE, paintPet, type PetLook } from '@/canvas/pets/paint';
import { PET_HEIGHT, PET_WIDTH, petFrame, petPlace, petsOf, type PetMood } from '@/canvas/pets/pet-state';
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

function prefersStill(): boolean {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/*
 * A canvas of its own that repaints on the shared beat, so React renders a pet only when its mood or
 * look changes, and the beat paints only a frame that differs from the one before it.
 */
export function PetFigure({ look, mood }: { look: PetLook; mood: PetMood }) {
    const ref = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        const context = ref.current?.getContext('2d') ?? null;
        if (context === null) {
            return;
        }
        const still = prefersStill();
        let painted = '';
        return onPetTick((tick) => {
            const frame = petFrame(mood, tick, still);
            const key = `${frame.pose}:${frame.frame}:${frame.lift}`;
            if (key !== painted) {
                painted = key;
                paintPet(context, look, frame);
            }
        });
    }, [look, mood]);
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

function Pet({ id, agent, mood }: { id: string; agent: AgentKind | undefined; mood: PetMood }) {
    const { t } = useTranslation('canvas');
    const canvasStore = useCanvasStore();
    const node = useCanvas((s) => s.nodes[id]);
    const look = usePetLook(agent);
    // A pet off screen keeps no beat; it stands where it was once its node comes back in view.
    const inView = useNodeInViewport(id);
    if (node === undefined) {
        return null;
    }
    const place = petPlace(node);
    // A node a person never named reads as its kind, so the label always says which node it leads to.
    const title = node.title?.trim() || t(node.kind === 'chat' ? 'kinds.chat' : 'kinds.terminal');
    const label = t(mood === 'waiting' ? 'pets.waiting' : 'pets.goTo', { title });
    return (
        <Tooltip label={label}>
            <button
                type="button"
                data-pet={id}
                data-pet-mood={mood}
                aria-label={label}
                className="pointer-events-auto absolute cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent"
                style={{ left: place.x, top: place.y, width: PET_WIDTH, height: PET_HEIGHT }}
                // A press on a pet is not the start of a box or a pan on the canvas under it.
                onPointerDown={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                onClick={(event) => {
                    event.stopPropagation();
                    canvasStore.getState().goToNode(id);
                }}
            >
                {inView && <PetFigure look={look} mood={mood} />}
            </button>
        </Tooltip>
    );
}

function CanvasPets() {
    const endpointId = useEndpointId();
    const nodes = useCanvas((s) => s.nodes);
    const hidden = useCanvas((s) => s.hidden);
    const sessions = useSessions((s) => s.byKey);
    const chats = useChats((s) => s.statusByKey);
    const snoozes = useSnoozes((s) => s.byKey);
    return petsOf(nodes, hidden, sessions, chats, endpointId, snoozes).map((pet) => <Pet key={pet.id} id={pet.id} agent={pet.agent} mood={pet.mood} />);
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
            const nodes = Object.values(state.nodes).filter((node) => !state.hidden.has(node.id));
            const spot = visitSpot(nodes, visibleRect(state.camera, state.viewport), Math.random);
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
            {pets ? <CanvasPets /> : visitorOn && <PetVisitor />}
        </div>
    );
}
