/* Tells a key or a press meant for a node's content (`data-node-body`) from one meant for the canvas around it. */
export function isInNodeBody(el: EventTarget | null): boolean {
    return el instanceof HTMLElement && el.closest('[data-node-body]') !== null;
}

/*
 * The node a card beside it belongs to (`data-derived-of`, `canvas/DerivedCards.tsx`). Such a card is
 * drawn from that node's data and is no node itself: a press in it hands that node the keyboard and
 * the wheel, and nothing selects, moves or links it.
 */
export function derivedOwnerOf(el: EventTarget | null): string | null {
    return el instanceof HTMLElement ? (el.closest<HTMLElement>('[data-derived-of]')?.dataset.derivedOf ?? null) : null;
}
