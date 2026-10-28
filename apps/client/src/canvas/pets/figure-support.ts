import { useSyncExternalStore } from 'react';
import type { TFunction } from 'i18next';
import type { PetMood } from '@/canvas/pets/pet-state';
import type { CanvasNode } from '@/state/canvas';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/* What an untitled node with a pet reads as; a chat is the rest, since only these kinds have one. */
const KIND_LABELS: Partial<Record<CanvasNode['kind'], 'kinds.design' | 'kinds.terminal'>> = { design: 'kinds.design', terminal: 'kinds.terminal' };

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

/* Whether a person asked for reduced motion, read again when they change it, so the figures stop or move at once. */
export function usePrefersStill(): boolean {
    return useSyncExternalStore(followMotion, prefersStill, () => false);
}

/* What a pet's button says: where it leads, and that it waits on you when it does. */
export function petLabel(t: TFunction<'canvas'>, node: CanvasNode, mood: PetMood): string {
    // A node a person never named reads as its kind, so the label always says which node it leads to.
    const title = node.title?.trim() || t(KIND_LABELS[node.kind] ?? 'kinds.chat');
    return t(mood === 'waiting' || mood === 'snoozed' ? 'pets.waiting' : 'pets.goTo', { title });
}
