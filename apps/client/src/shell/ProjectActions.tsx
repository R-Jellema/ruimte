import { useTranslation } from 'react-i18next';
import { AppWindow, ExternalLink, Settings2, X } from 'lucide-react';
import type { ProjectMenuRow } from '@/project/list';
import { canOpenWindows, moveToNewWindow, openInNewWindow } from '@/project/windows';
import { fileManagerName } from '@/state/server';
import { transportFor } from '@/transport';
import { Icon, Menu } from '@adecore/ui';

/* What a row offers for its folder and its window; a recent project offers only these. */
export function ProjectPlaceActions({ row, platform, current }: { row: ProjectMenuRow; platform: string | null; current: boolean }) {
    const { t } = useTranslation('shell');
    const { summary } = row;

    const reveal = async (): Promise<void> => {
        if (!summary.folder) {
            return;
        }
        await transportFor(row.endpointId)
            ?.request('fs.reveal', { path: summary.folder })
            .catch(() => undefined);
    };

    return (
        <>
            {summary.folder && (
                <Menu.Item onClick={() => void reveal()}>
                    <Icon icon={ExternalLink} size={14} /> {t('projectMenu.openIn', { app: fileManagerName(platform) })}
                </Menu.Item>
            )}
            {canOpenWindows() && (
                <Menu.Item
                    disabled={!current && !summary.available}
                    onClick={() => (current ? void moveToNewWindow() : openInNewWindow(row.endpointId, summary.projectId))}
                >
                    <Icon icon={AppWindow} size={14} /> {t(current ? 'projectMenu.moveToNewWindow' : 'projectMenu.openInNewWindow')}
                </Menu.Item>
            )}
        </>
    );
}

export function ProjectActions({
    row,
    platform,
    current,
    onSettings,
    onClose
}: {
    row: ProjectMenuRow;
    platform: string | null;
    current: boolean;
    onSettings(): void;
    onClose(): void;
}) {
    const { t } = useTranslation('shell');

    return (
        <>
            <ProjectPlaceActions row={row} platform={platform} current={current} />
            <Menu.Item onClick={onSettings}>
                <Icon icon={Settings2} size={14} /> {t('projectMenu.projectSettings')}
            </Menu.Item>
            <Menu.Separator />
            <Menu.Item onClick={onClose}>
                <Icon icon={X} size={14} /> {t('projectMenu.closeProject')}
            </Menu.Item>
        </>
    );
}
