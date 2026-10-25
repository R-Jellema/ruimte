import { kindIcon } from '@/output/kinds';
import { ProjectGlyph } from '@/project/ProjectGlyph';
import { useProjectList } from '@/state/project-list';
import type { ComponentProps } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Icon, ListRow, Spinner } from '@adecore/ui';

/* One thing to do with the version an artifact view shows, a row of the list at the foot of its info column. */
export function ActionRow({ icon, busy = false, children, ...props }: ComponentProps<'button'> & { icon: LucideIcon; busy?: boolean }) {
    return (
        <ListRow
            variant="inset"
            render={<button type="button" {...props} />}
            className="w-full gap-2 text-left text-sm text-text hover:bg-surface-hover disabled:text-text-faint disabled:hover:bg-transparent aria-disabled:text-text-faint aria-disabled:hover:bg-transparent aria-pressed:bg-surface-active"
        >
            {busy ? <Spinner size={14} /> : <Icon icon={icon} size={14} className="shrink-0 text-text-muted" />}
            <span className="min-w-0 truncate">{children}</span>
        </ListRow>
    );
}

/* The square mark of a kind at the start of a row or a chip. */
export function KindTile({ kind, size = 'md' }: { kind: string; size?: 'sm' | 'md' }) {
    return (
        <span
            aria-hidden="true"
            className={`grid shrink-0 place-items-center rounded-md bg-surface-sunken text-text-muted dark:bg-field dark:inset-ring dark:inset-ring-field-border ${size === 'md' ? 'size-8' : 'size-5'}`}
        >
            <Icon icon={kindIcon(kind)} size={size === 'md' ? 16 : 12} />
        </span>
    );
}

/* The project's own mark, for a row of Output that may come from any project on the machine. */
export function OutputProjectGlyph({ endpointId, projectId, size = 14 }: { endpointId: string; projectId: string; size?: number }) {
    const summary = useProjectList((s) => s.projects.find((row) => row.endpointId === endpointId && row.summary.projectId === projectId)?.summary);
    if (summary === undefined) {
        return null;
    }
    return (
        <ProjectGlyph projectId={projectId} endpointId={endpointId} icon={summary.icon} color={summary.color} size={size} scratch={summary.scratch === true} />
    );
}
