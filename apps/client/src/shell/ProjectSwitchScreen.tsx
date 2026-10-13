import type { ReactNode } from 'react';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';
import { CircleAlert, LoaderCircle, Moon, type LucideIcon } from 'lucide-react';
import { MachineGlyph } from '@/endpoint/MachineGlyph';
import { projectSwitch, useProjectSwitch } from '@/project/open';
import { ProjectGlyph } from '@/project/ProjectGlyph';
import type { SwitchState, SwitchTarget } from '@/project/project-switch';
import { describeRoute } from '@/shell/connection-info';
import { basenameOf } from '@/shell/panels/files-tree';
import { useMachineIcon } from '@/shell/settings/machine-icon';
import { nameOf } from '@/shell/settings/machine-list';
import { useMachineEntry } from '@/shell/use-machine-entry';
import { useProjectList } from '@/state/project-list';
import { useWindow } from '@/state/window';
import { useEndpointConnection } from '@/transport/status';
import { Button, Icon } from '@adecore/ui';

/* What is being opened, in the words a person picked it by. */
function titleOf(target: SwitchTarget, machine: string): string {
    return target.summary?.name ?? target.name ?? (target.folder !== null ? basenameOf(target.folder) || target.folder : machine);
}

function lineOf(state: Exclude<SwitchState, { kind: 'idle' }>, title: string, machine: string): string {
    switch (state.kind) {
        case 'connecting':
            return i18next.t('shell:switch.connecting', { machine });
        case 'opening':
            return i18next.t('shell:switch.opening', { title });
        case 'returning':
            return i18next.t('shell:switch.returning');
        case 'failed':
            return state.reason;
    }
}

interface StatusCardProps {
    glyph: ReactNode;
    title: string;
    /* The line under the title: the machine a project is on, or when a machine was last seen. */
    meta?: ReactNode;
    line: string;
    failed: boolean;
    /* Stands in for the spinner, for a window that is not waiting on anything. */
    icon?: LucideIcon;
    children?: ReactNode;
}

/* The card the window shows while it waits on a machine or after one failed it: what, where, why, and what to do. */
export function StatusCard({ glyph, title, meta, line, failed, icon, children }: StatusCardProps) {
    return (
        <div className="flex w-80 max-w-full flex-col items-center gap-3 px-6 text-center">
            {glyph}
            <div className="flex max-w-full flex-col items-center gap-1">
                <span className="max-w-full truncate text-sm font-medium text-text">{title}</span>
                {meta}
            </div>
            <p className="flex items-start gap-2 text-xs leading-snug text-text-muted">
                <Icon
                    icon={failed ? CircleAlert : (icon ?? LoaderCircle)}
                    size={14}
                    className={failed ? 'mt-px shrink-0 text-status-error' : icon ? 'mt-px shrink-0' : 'mt-px shrink-0 animate-spin'}
                />
                <span>{line}</span>
            </p>
            {children && <div className="mt-2 flex items-center gap-2">{children}</div>}
        </div>
    );
}

function SwitchCard({ state }: { state: Exclude<SwitchState, { kind: 'idle' }> }) {
    const { t } = useTranslation(['shell', 'common']);
    const { target } = state;
    const entry = useMachineEntry(target.endpointId);
    const machineIcon = useMachineIcon(entry);
    const route = describeRoute(useEndpointConnection(entry.endpoint?.id ?? target.endpointId));
    const machine = nameOf(entry);
    const title = titleOf(target, machine);
    // A project the cached list does not have has nothing but its machine's name to show, and saying it twice says nothing.
    const aboutMachine = target.summary === null && target.folder === null && target.name === null;
    const failed = state.kind === 'failed';

    return (
        <StatusCard
            glyph={
                target.summary ? (
                    <ProjectGlyph
                        projectId={target.summary.projectId}
                        endpointId={target.endpointId}
                        icon={target.summary.icon}
                        color={target.summary.color}
                        size={24}
                        scratch={target.summary.scratch === true}
                    />
                ) : (
                    <MachineGlyph icon={aboutMachine ? machineIcon : null} size={24} className="text-text-faint" />
                )
            }
            title={title}
            meta={
                !aboutMachine && (
                    <span className="flex max-w-full items-center gap-1.5 text-xs text-text-muted">
                        <MachineGlyph icon={machineIcon} size={12} />
                        <span className="truncate">{machine}</span>
                        {/* Known only once the link is open, which is exactly when the project step runs. */}
                        {state.kind === 'opening' && route !== null && <span className="shrink-0 text-text-faint">· {route}</span>}
                    </span>
                )
            }
            line={lineOf(state, title, machine)}
            failed={failed}
        >
            {(state.kind === 'connecting' || state.kind === 'opening') && (
                <Button size="sm" variant="secondary" onClick={() => projectSwitch.cancel()}>
                    {t('common:action.cancel')}
                </Button>
            )}
            {failed && (
                <>
                    <Button size="sm" variant="secondary" onClick={() => void projectSwitch.back()}>
                        {t('switch.goBack')}
                    </Button>
                    <Button size="sm" variant="primary" onClick={() => void projectSwitch.retry()}>
                        {t('common:action.retry')}
                    </Button>
                </>
            )}
        </StatusCard>
    );
}

/*
 * Stands over the main column (or the whole start screen) while the window moves to another project, so
 * a machine that takes seconds to answer reads as waiting rather than frozen. Nothing for the first
 * moments (`REVEAL_DELAY_MS`); a failure stays until a person picks what to do about it.
 */
export function ProjectSwitchScreen() {
    const state = useProjectSwitch((s) => s);
    if (state.kind === 'idle' || (state.kind !== 'failed' && !state.visible)) {
        return null;
    }
    return (
        <div className="absolute inset-0 z-10 grid place-items-center bg-surface" role="status" aria-live="polite">
            <SwitchCard state={state} />
        </div>
    );
}

/* A window back from the last session that waits for the focus before it opens its project. */
export function DormantScreen() {
    const { t } = useTranslation('shell');
    const dormant = useWindow((s) => s.dormant);
    const summary = useProjectList(
        (s) =>
            s.projects.find((row) => dormant !== null && row.endpointId === dormant.endpointId && row.summary.projectId === dormant.projectId)?.summary ?? null
    );
    const entry = useMachineEntry(dormant?.endpointId ?? '');
    const machineIcon = useMachineIcon(entry);
    if (dormant === null) {
        return null;
    }
    const machine = nameOf(entry);
    return (
        <div className="absolute inset-0 z-10 grid place-items-center bg-surface" role="status">
            <StatusCard
                glyph={
                    summary ? (
                        <ProjectGlyph
                            projectId={summary.projectId}
                            endpointId={dormant.endpointId}
                            icon={summary.icon}
                            color={summary.color}
                            size={24}
                            scratch={summary.scratch === true}
                        />
                    ) : (
                        <MachineGlyph icon={machineIcon} size={24} className="text-text-faint" />
                    )
                }
                title={summary?.name ?? machine}
                line={t('switch.dormant')}
                failed={false}
                icon={Moon}
            />
        </div>
    );
}
