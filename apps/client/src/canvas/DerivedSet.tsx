import type { ReactNode } from 'react';
import { routeEdge, type Obstacle } from '@/canvas/edge-route';
import { intersects, isMeasured, visibleRect, type Rect } from '@/canvas/math';
import { useCanvas, type CanvasState } from '@/state/canvas';

export interface DerivedCard {
    key: string;
    rect: Rect;
    /* Where its line comes from: the node itself, the key of another card, or nothing for a card without one. */
    linkedFrom: 'node' | string | null;
    label: string;
    content: ReactNode;
}

/*
 * The cards a node has drawn beside it from its own data (`DerivedCards`), and the lines from it or
 * from one card to another, which belong to the canvas as every line does. They route around the nodes and the other
 * cards, in the layer under the nodes, and only the cards are stacked with their node. A line here is
 * the neutral stroke with nothing at either end, by Bas's choice: it carries nothing and points at
 * nothing, so it wears none of the looks in `edge-look.ts`.
 */
export function DerivedSet({ owner, z, cards }: { owner: string; z: number; cards: readonly DerivedCard[] }) {
    const node = useCanvas((s) => s.nodes[owner]);
    const nodes = useCanvas((s) => s.nodes);
    const hidden = useCanvas((s) => s.hidden);
    if (node === undefined) {
        return null;
    }
    const blocking: Obstacle[] = [
        ...Object.values(nodes)
            .filter((other) => other.id !== owner && other.kind !== 'group' && !hidden.has(other.id))
            .map(({ id, x, y, w, h }) => ({ id, x, y, w, h })),
        ...cards.map((card) => ({ id: card.key, ...card.rect }))
    ];
    const rectOf = (from: string | null): Rect | null => (from === 'node' ? node : (cards.find((card) => card.key === from)?.rect ?? null));
    const routes = cards.flatMap((card) => {
        const from = rectOf(card.linkedFrom);
        if (from === null) {
            return [];
        }
        // Held to the right side, so the lines leave as one and fan out to the column beside.
        const route = routeEdge(
            from,
            card.rect,
            blocking.filter((obstacle) => obstacle.id !== card.key && obstacle.id !== card.linkedFrom),
            { fromSide: 'right', toSide: 'left' }
        );
        return [{ key: card.key, route }];
    });
    return (
        <>
            <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1" aria-hidden>
                {routes.map(({ key, route }) => (
                    <path key={key} d={route.d} fill="none" stroke="var(--edge-line)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                ))}
            </svg>
            {cards.map((card) => (
                <Card key={card.key} owner={owner} z={z} card={card} />
            ))}
        </>
    );
}

/* A card further than a viewport past every edge is left out, the way the canvas leaves out a far node (`farNodeKey`). */
function nearView(s: CanvasState, rect: Rect): boolean {
    return !isMeasured(s.viewport) || intersects(rect, visibleRect(s.camera, s.viewport, Math.max(s.viewport.w, s.viewport.h)));
}

function Card({ owner, z, card }: { owner: string; z: number; card: DerivedCard }) {
    const { x, y, w, h } = card.rect;
    const near = useCanvas((s) => nearView(s, { x, y, w, h }));
    if (!near) {
        return null;
    }
    return (
        <section
            data-derived-of={owner}
            data-node-body
            aria-label={card.label}
            className="absolute flex flex-col"
            style={{ left: x, top: y, width: w, height: h, zIndex: z }}
            // A card has no menu of its own, and the canvas's would offer to add a node under it.
            onContextMenu={(e) => e.stopPropagation()}
        >
            {card.content}
        </section>
    );
}
