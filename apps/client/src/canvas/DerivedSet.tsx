import { useEffect, type ReactNode } from 'react';
import { routeEdge, type Obstacle } from '@/canvas/edge-route';
import { intersects, isMeasured, visibleRect, type Rect } from '@/canvas/math';
import type { ResizableCard } from '@/canvas/resize-handles';
import { useCanvas, type CanvasState } from '@/state/canvas';

export interface DerivedCard {
    key: string;
    rect: Rect;
    /* Where its line comes from: the node itself, the key of another card, or nothing for a card without one. */
    linkedFrom: 'node' | string | null;
    label: string;
    content: ReactNode;
    /* How far down its side its lines meet it, in world units from its top; the middle when absent. */
    lineDown?: number;
    /* Offered to the canvas's resize handles; a card without one keeps the size its layout gives it. */
    resize?: Omit<ResizableCard, 'rect'>;
}

/*
 * The cards a node has drawn beside it from its own data (`DerivedCards`), and the lines from it or
 * from one card to another, which belong to the canvas as every line does. They route around the nodes and the other
 * cards, in the layer under the nodes, and only the cards are stacked with their node. A line here is
 * the neutral stroke with nothing at either end, by Bas's choice: it carries nothing and points at
 * nothing, so it wears none of the looks in `edge-look.ts`.
 */
export function DerivedSet({ owner, z, cards, lineDown }: { owner: string; z: number; cards: readonly DerivedCard[]; lineDown?: number }) {
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
    const endOf = (from: string | null): { rect: Rect; down: number | undefined } | null => {
        if (from === 'node') {
            return { rect: node, down: lineDown };
        }
        const card = cards.find((candidate) => candidate.key === from);
        return card === undefined ? null : { rect: card.rect, down: card.lineDown };
    };
    const routes = cards.flatMap((card) => {
        const from = endOf(card.linkedFrom);
        if (from === null) {
            return [];
        }
        // Held to the right side, so the lines leave as one and fan out to the column beside.
        const route = routeEdge(
            from.rect,
            card.rect,
            blocking.filter((obstacle) => obstacle.id !== card.key && obstacle.id !== card.linkedFrom),
            { fromSide: 'right', toSide: 'left', fromDown: from.down, toDown: card.lineDown }
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
    const setResizableCard = useCanvas((s) => s.setResizableCard);
    const { resize } = card;
    // An id no node has, so a press on its handle can never be read as one on a node.
    const resizeId = `derived:${owner}:${card.key}`;
    useEffect(() => {
        if (resize === undefined) {
            return;
        }
        setResizableCard(resizeId, { ...resize, rect: { x, y, w, h } });
        return () => setResizableCard(resizeId, null);
    }, [h, resize, resizeId, setResizableCard, w, x, y]);
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
