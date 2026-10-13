import { Fragment, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Frame, Globe, Heading, Minus, PenTool, Workflow, Terminal } from 'lucide-react';
import type { ProviderInfo } from '@ruimte/contracts';
import { ProviderRows } from '@/agents/ProviderRows';
import { AgentSubmenu } from '@/agents/AgentMenus';
import { agentTargetLabel, type AgentTarget } from '@/agents/nodes';
import { createViewAction } from '@/actions/client-actions';
import { newSubheaderView } from '@/project/views';
import { shownFolderOf, useProject } from '@/state/project';
import { Tile, Icon, Menu, Kbd, SectionLabel } from '@adecore/ui';
import { labelCollator } from '@adecore/ui/format';
import { useUi } from '@/state/ui';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';

/* A row of one of the two lists below, with the label it is put in order by. */
interface NewViewEntry {
    id: string;
    label: string;
    node: ReactNode;
}

/* The rows of one list sorted by their labels in the interface language; a row nobody is offered drops out. */
function inOrder(entries: (NewViewEntry | false)[]): ReactNode[] {
    const order = labelCollator();
    return entries
        .filter((entry): entry is NewViewEntry => entry !== false)
        .sort((one, other) => order.compare(one.label, other.label))
        .map((entry) => <Fragment key={entry.id}>{entry.node}</Fragment>);
}

export function NewViewTiles({ size = 'sm' }: { size?: 'sm' | 'md' }) {
    const { t } = useTranslation('shell');
    const hasFolder = useProject((s) => shownFolderOf(s.current) !== null);
    const tools = [
        { kind: 'terminal', icon: Terminal, run: () => void createViewAction('terminal') },
        { kind: 'browser', icon: Globe, run: () => useUi.getState().setViewDialog({ kind: 'new-browser' }) },
        ...(hasFolder ? [{ kind: 'file', icon: FileText, run: () => useUi.getState().openFilePicker({ kind: 'view' }) }] : []),
        { kind: 'canvas', icon: Frame, run: () => void createViewAction('canvas') },
        { kind: 'diagram', icon: Workflow, run: () => void createViewAction('diagram') },
        { kind: 'drawing', icon: PenTool, run: () => void createViewAction('drawing') }
    ];
    return (
        <div className="flex flex-col gap-6">
            <ProviderRows onPick={(provider) => void createViewAction('chat', { provider: provider.kind })} />
            <section className="flex flex-col gap-2">
                <SectionLabel render={<h2 />} className="px-1">
                    {t('projectStart.open')}
                </SectionLabel>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(88px,1fr))] gap-2">
                    {tools.map((tool) => (
                        <Tile
                            key={tool.kind}
                            className="min-h-22 flex-col justify-center gap-2! text-center [&>span:last-child]:grow-0 [&>span:last-child]:items-center [&>span:first-child]:bg-transparent"
                            size={size}
                            icon={<Icon icon={tool.icon} size={20} />}
                            title={t(`viewKinds.${tool.kind}`)}
                            onClick={tool.run}
                        />
                    ))}
                </div>
            </section>
        </div>
    );
}

/*
 * What the plus in the sidebar offers: a canvas or one session, and under a line the two rows that
 * divide the list. The agent submenus are the dock's, so the CLI list never drifts apart. Each group
 * is sorted on its own, since sorting across the line would lose what it separates.
 */
export function NewViewItems() {
    const { t } = useTranslation('shell');
    /* A file comes out of the open folder, so a project without one has nothing to pick from. */
    const hasFolder = useProject((s) => shownFolderOf(s.current) !== null);
    const pickAgent = (target: AgentTarget, provider: ProviderInfo): void => void createViewAction(target, { provider: provider.kind });
    return (
        <>
            {inOrder([
                {
                    id: 'canvas',
                    label: t('viewKinds.canvas'),
                    node: (
                        <Menu.Item onClick={() => void createViewAction('canvas')}>
                            <Icon icon={Frame} size={14} /> {t('viewKinds.canvas')} <Kbd shortcut={CANVAS_SHORTCUTS.newView} />
                        </Menu.Item>
                    )
                },
                {
                    id: 'drawing',
                    label: t('viewKinds.drawing'),
                    node: (
                        <Menu.Item onClick={() => void createViewAction('drawing')}>
                            <Icon icon={PenTool} size={14} /> {t('viewKinds.drawing')}
                        </Menu.Item>
                    )
                },
                {
                    id: 'diagram',
                    label: t('viewKinds.diagram'),
                    node: (
                        <Menu.Item onClick={() => void createViewAction('diagram')}>
                            <Icon icon={Workflow} size={14} /> {t('viewKinds.diagram')}
                        </Menu.Item>
                    )
                },
                {
                    id: 'terminal',
                    label: t('viewKinds.terminal'),
                    node: (
                        <Menu.Item onClick={() => void createViewAction('terminal')}>
                            <Icon icon={Terminal} size={14} /> {t('viewKinds.terminal')}
                        </Menu.Item>
                    )
                },
                { id: 'agent-chat', label: agentTargetLabel('chat'), node: <AgentSubmenu target="chat" onPick={pickAgent} /> },
                { id: 'agent-terminal', label: agentTargetLabel('terminal'), node: <AgentSubmenu target="terminal" onPick={pickAgent} /> },
                {
                    id: 'browser',
                    label: t('viewKinds.browser'),
                    node: (
                        <Menu.Item onClick={() => useUi.getState().setViewDialog({ kind: 'new-browser' })}>
                            <Icon icon={Globe} size={14} /> {t('viewKinds.browser')}
                        </Menu.Item>
                    )
                },
                hasFolder && {
                    id: 'file',
                    label: t('viewMenu.filePick'),
                    node: (
                        <Menu.Item onClick={() => useUi.getState().openFilePicker({ kind: 'view' })}>
                            <Icon icon={FileText} size={14} /> {t('viewMenu.filePick')}
                        </Menu.Item>
                    )
                }
            ])}
            <Menu.Separator />
            {inOrder([
                {
                    id: 'separator',
                    label: t('viewKinds.separator'),
                    node: (
                        <Menu.Item onClick={() => void createViewAction('separator')}>
                            <Icon icon={Minus} size={14} /> {t('viewKinds.separator')}
                        </Menu.Item>
                    )
                },
                {
                    id: 'subheader',
                    label: t('viewKinds.subheader'),
                    node: (
                        <Menu.Item onClick={() => void newSubheaderView()}>
                            <Icon icon={Heading} size={14} /> {t('viewKinds.subheader')}
                        </Menu.Item>
                    )
                }
            ])}
        </>
    );
}
