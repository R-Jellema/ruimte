import type { NodeKind } from '@ruimte/contracts';

/*
 * Whether a press on a node's header or frame hands the keyboard to its content, the way a title bar
 * does. A group holds nothing to type in, and a press that adds to the selection is about moving nodes.
 */
export function framePressHandsKeyboard(kind: NodeKind | 'unknown' | undefined, additive: boolean): boolean {
    return kind !== undefined && kind !== 'group' && !additive;
}
