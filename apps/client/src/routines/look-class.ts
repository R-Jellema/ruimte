import clsx from 'clsx';
import type { BlockLook } from '@/routines/agenda';

/* Paused times are hatched in the line color, so they read as time that passed by rather than as a run. */
export const HATCH = 'bg-[repeating-linear-gradient(135deg,var(--color-border)_0_3px,transparent_3px_7px)]';

/* A run that happened is filled in its state's tint; what did not happen, or has yet to, is only outlined. */
const SURFACE: Record<BlockLook, string> = {
    done: 'border border-positive/30 bg-positive/12 text-positive',
    waited: 'border border-positive/30 bg-positive/12 text-positive',
    waiting: 'border border-status-needs-you/45 bg-status-needs-you/15 text-status-needs-you',
    'caught-up': 'border border-border bg-surface-sunken text-text-muted',
    limit: 'border border-status-error/60 text-status-error',
    skipped: 'border border-dashed border-border-strong text-text-faint',
    paused: clsx('border border-border text-text-faint', HATCH),
    next: 'border border-dashed border-border-strong text-text-muted',
    running: 'border border-accent/45 bg-accent/15 text-accent',
    failed: 'border border-status-error/60 text-status-error'
};

export function blockClass(look: BlockLook): string {
    return clsx('rounded-md bg-clip-padding', SURFACE[look]);
}
