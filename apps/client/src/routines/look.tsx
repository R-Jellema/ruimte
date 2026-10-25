import clsx from 'clsx';
import { CircleCheck, CircleDot, CircleX, Gauge, Hand, Moon, Pause, SkipForward, type LucideIcon } from 'lucide-react';
import { Icon } from '@adecore/ui';
import type { BlockLook } from '@/routines/agenda';
import { blockClass } from '@/routines/look-class';

const ICONS: Partial<Record<BlockLook, { icon: LucideIcon; className: string }>> = {
    done: { icon: CircleCheck, className: 'text-positive' },
    waited: { icon: Hand, className: 'text-status-needs-you' },
    waiting: { icon: Hand, className: 'text-status-needs-you' },
    'caught-up': { icon: Moon, className: 'text-status-running' },
    limit: { icon: Gauge, className: 'text-status-needs-you' },
    skipped: { icon: SkipForward, className: 'text-text-faint' },
    paused: { icon: Pause, className: 'text-text-faint' },
    running: { icon: CircleDot, className: 'text-accent' },
    failed: { icon: CircleX, className: 'text-status-error' }
};

export function LookIcon({ look, size = 12 }: { look: BlockLook; size?: number }) {
    const entry = ICONS[look];
    if (entry === undefined) {
        return null;
    }
    return <Icon icon={entry.icon} size={size} className={clsx('shrink-0', entry.className)} />;
}

/* The swatch a legend row shows beside its words. */
export function LookSwatch({ look }: { look: BlockLook }) {
    return <span aria-hidden="true" className={clsx('h-4 w-7 shrink-0', blockClass(look))} />;
}
