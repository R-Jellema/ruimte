import { useSyncExternalStore } from 'react';
import clsx from 'clsx';
import { DropPreview as SharedDropPreview } from '@adecore/ui';
import { dropPreview, subscribeDropPreview } from '@/shell/drop-preview';

/*
 * Where the dragged view would land: a rectangle for a split or a trade, a tab grown into the cell
 * for a tab. It stands in the layer over the parked pages and in the grid's own coordinates, so no
 * cell clips it and a page never hides it. It keeps its shape while it fades out.
 */
export function DropPreview() {
    const { shape, shown, morph } = useSyncExternalStore(subscribeDropPreview, dropPreview);
    return (
        <SharedDropPreview
            shape={shape}
            className={clsx(
                'transition-opacity duration-100',
                shown ? 'opacity-100' : 'opacity-0',
                // A shape that follows a hidden preview takes its place without moving there from the last drag.
                !morph && '[&_path]:transition-none'
            )}
        />
    );
}
