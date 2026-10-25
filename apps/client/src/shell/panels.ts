import { Activity, CircleAlert, Database, Folder, GitBranch, Package, Rocket, TabletSmartphone, type LucideIcon } from 'lucide-react';
import { panelHidden, type PanelKind } from '@/state/ui';

/* The panels, in the order their buttons sit in the toolbar. They share one stored width and each
   clamps it to its own `minWidth` on screen only, so a wide minimum never overwrites it. The name a
   person reads is `panel.names.<kind>`, so the table stays the same in every language. Processes is
   something to look at now and then rather than a place to work, so it opens from the Window menu
   and has no button. Launches has none either: the launch chip opens it and shows it pressed. The
   buttons come in two groups: the project's own work (its files, its history, what was made for it),
   then what lives outside it and is connected to it. */
export const PANELS: { kind: PanelKind; icon: LucideIcon; minWidth: number; toolbar: boolean; group: 'project' | 'connected' }[] = [
    { kind: 'files', icon: Folder, minWidth: 240, toolbar: true, group: 'project' },
    { kind: 'git', icon: GitBranch, minWidth: 240, toolbar: true, group: 'project' },
    { kind: 'output', icon: Package, minWidth: 300, toolbar: true, group: 'project' },
    { kind: 'databases', icon: Database, minWidth: 260, toolbar: true, group: 'connected' },
    { kind: 'devices', icon: TabletSmartphone, minWidth: 320, toolbar: true, group: 'connected' },
    { kind: 'processes', icon: Activity, minWidth: 420, toolbar: false, group: 'project' },
    { kind: 'launches', icon: Rocket, minWidth: 480, toolbar: false, group: 'project' },
    { kind: 'problems', icon: CircleAlert, minWidth: 360, toolbar: false, group: 'project' }
];

/* The panels with a button in the toolbar of a project, which the Chats project has fewer of. */
export function toolbarPanels(scratch: boolean) {
    return PANELS.filter((entry) => entry.toolbar && !panelHidden(entry.kind, scratch));
}
