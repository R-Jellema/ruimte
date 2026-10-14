import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderInput, FolderPlus } from 'lucide-react';
import { moveTargetsOf } from '@/project/move-targets';
import { ProjectGlyph } from '@/project/ProjectGlyph';
import { useEndpoints } from '@/state/endpoints';
import { useProjectList } from '@/state/project-list';
import { useUi } from '@/state/ui';
import { DisabledReason, Icon, Menu } from '@adecore/ui';

interface MoveChatItemsProps {
    chatId: string;
    endpointId: string;
    /* The chat runs a turn or waits on a person, which the move refuses. */
    working: boolean;
}

/*
 * Making a project of a chat in Chats, or moving it into one: the dialog does the asking, so a row only
 * says where it starts. Both are off while the chat works, with the reason on a tooltip.
 */
export function MoveChatItems({ chatId, endpointId, working }: MoveChatItemsProps) {
    const { t } = useTranslation('shell');
    const rows = useProjectList((state) => state.projects);
    const endpoints = useEndpoints((state) => state.endpoints);
    const targets = useMemo(() => moveTargetsOf(rows, endpoints, endpointId), [rows, endpoints, endpointId]);
    const reason = working ? t('viewMenu.moveWhileWorking') : null;
    const ask = (projectId: string | null): void => useUi.getState().setMoveChatDialog({ chatId, projectId });
    return (
        <>
            <DisabledReason reason={reason}>
                <Menu.Item disabled={working} onClick={() => ask(null)}>
                    <Icon icon={FolderPlus} size={14} /> {t('viewMenu.makeProject')}
                </Menu.Item>
            </DisabledReason>
            <Menu.SubmenuRoot>
                <DisabledReason reason={reason}>
                    <Menu.SubmenuTrigger disabled={working}>
                        <Icon icon={FolderInput} size={14} /> {t('viewMenu.moveToProject')}
                    </Menu.SubmenuTrigger>
                </DisabledReason>
                <Menu.Popup className="min-w-52">
                    {targets.map((summary) => (
                        <Menu.Item key={summary.projectId} onClick={() => ask(summary.projectId)}>
                            <ProjectGlyph projectId={summary.projectId} endpointId={endpointId} icon={summary.icon} color={summary.color} />
                            <span className="truncate">{summary.name}</span>
                        </Menu.Item>
                    ))}
                    {targets.length > 0 && <Menu.Separator />}
                    <Menu.Item onClick={() => ask(null)}>{t('viewMenu.otherProject')}</Menu.Item>
                </Menu.Popup>
            </Menu.SubmenuRoot>
        </>
    );
}
