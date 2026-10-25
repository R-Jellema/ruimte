import clsx from 'clsx';
import type { BlockLook } from '@/routines/agenda';

/* Paused times are hatched in the line color, so they read as time that passed by rather than as a run. */
const HATCH = 'bg-[repeating-linear-gradient(135deg,var(--color-border)_0_3px,transparent_3px_7px)]';

const SURFACE: Record<BlockLook, string> = {
    done: 'border border-border bg-surface-raised text-text',
    waited: 'border border-status-needs-you/50 bg-status-needs-you/15 text-text',
    waiting: 'border border-status-needs-you/70 bg-status-needs-you/25 text-text',
    'caught-up': 'border border-status-running/50 bg-status-running/15 text-text',
    limit: 'border border-dashed border-status-needs-you/70 text-text',
    skipped: 'border border-dashed border-border-strong text-text-faint',
    paused: clsx('border border-border text-text-faint', HATCH),
    next: 'border border-dotted border-border-strong text-text-muted',
    running: 'border border-accent/60 bg-accent-soft text-text',
    failed: 'border border-status-error/50 bg-status-error/10 text-text'
};

export function blockClass(look: BlockLook): string {
    return clsx('rounded-md bg-clip-padding', SURFACE[look]);
}
