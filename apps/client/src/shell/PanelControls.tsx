import { useTranslation } from 'react-i18next';
import { useRoutineList } from '@/routines/routine-list';
import { RoutinesButton } from '@/routines/RoutinesButton';
import { leaveRoutines, useRoutinesStage } from '@/routines/stage';
import { toolbarPanels, type PanelGroup } from '@/shell/panels';
import { useFolderInRepo } from '@/state/git-repos';
import { useGitStatus } from '@/state/git-watch';
import { useEndpointId } from '@/state/keys';
import { isThisMachine } from '@/state/local-machine';
import { isScratchProject, useProject } from '@/state/project';
import { useShownPanel, useUi } from '@/state/ui';
import { Fragment } from 'react';
import { ButtonGroup, IconButton, Separator } from '@adecore/ui';

const GROUPS: readonly PanelGroup[] = ['project', 'connected', 'made'];

/* The panel toggles, and the Routines clock beside Output. They stay in the toolbar whether a panel is open or not, so a toggle never
   moves out from under the pointer; the panel's own header carries its title and its close button
   and nothing that belongs to the toolbar. */
export function PanelControls() {
    const { t } = useTranslation('shell');
    const panel = useShownPanel();
    const routines = useRoutinesStage((s) => s.open);
    const scratch = useProject((s) => isScratchProject(s.current));
    const folder = useProject((s) => s.current?.folder ?? null);
    const entries = toolbarPanels(scratch);
    const endpointId = useEndpointId();
    // Only a checkout of this machine is watched for the dot: a project elsewhere would hold a watch on that machine all the while.
    const candidate = entries.some((entry) => entry.kind === 'git') && isThisMachine(endpointId) ? folder : null;
    const repo = useFolderInRepo(candidate);
    /* The project folder's own checkout, which is what the panel shows first; it shares the watch the git and files panels hold. */
    const changes = useGitStatus(repo ? candidate : null)?.files.length ?? 0;

    const routinesShown = useRoutineList(endpointId) !== null;
    const groups = GROUPS.map((key) => ({ key, entries: entries.filter((entry) => entry.group === key) })).filter(
        (group) => group.entries.length > 0 || (group.key === 'made' && routinesShown)
    );

    return (
        <>
            {groups.map((group, index) => (
                <Fragment key={group.key}>
                    {index > 0 && <Separator />}
                    <ButtonGroup>
                        {group.entries.map((entry) => {
                            const dirty = entry.kind === 'git' && changes > 0;
                            return (
                                <IconButton
                                    key={entry.kind}
                                    icon={entry.icon}
                                    label={dirty ? t('panel.gitChanges', { count: changes }) : t(`panel.names.${entry.kind}`)}
                                    active={!routines && panel.open && panel.kind === entry.kind}
                                    className={dirty ? 'relative' : undefined}
                                    onClick={() => {
                                        // Routines hides the panel rather than closing it, so a press here shows the panel it asks for.
                                        if (routines) {
                                            leaveRoutines();
                                            useUi.getState().setPanel({ open: true, kind: entry.kind });
                                        } else {
                                            useUi.getState().togglePanel(entry.kind);
                                        }
                                    }}
                                >
                                    {/* Gray as the unsaved dot is: it says there is something to commit, not that something is wrong. */}
                                    {dirty && (
                                        <span aria-hidden="true" className="pointer-events-none absolute top-1 right-1 size-1.5 rounded-full bg-text-faint" />
                                    )}
                                </IconButton>
                            );
                        })}
                        {group.key === 'made' && <RoutinesButton />}
                    </ButtonGroup>
                </Fragment>
            ))}
        </>
    );
}
