import { create } from 'zustand';
import { artifactTabKey, openArtifactTab, useFiles } from '@/state/files';
import { useSettings } from '@/state/settings';
import { useUi } from '@/state/ui';

/* The version each open artifact view shows, by tab key; absent follows the latest. */
export const useArtifactSelection = create<{ versions: Readonly<Record<string, string>> }>(() => ({ versions: {} }));

export function selectArtifactVersion(artifactId: string, versionId: string | null): void {
    const key = artifactTabKey(artifactId);
    useArtifactSelection.setState((state) => {
        const { [key]: _was, ...rest } = state.versions;
        return { versions: versionId === null ? rest : { ...rest, [key]: versionId } };
    });
}

/* An artifact as a loose view of the window's project, the way a file opens from the files panel. */
export function openArtifact(artifactId: string, title: string, versionId: string | null = null): void {
    selectArtifactVersion(artifactId, versionId);
    const files = useFiles.getState();
    files.show(openArtifactTab(files, artifactId, title), useSettings.getState().filesTabLimit);
}

/* Output in the panel of the window, from a chat or anywhere else that points at it. */
export function showOutputPanel(): void {
    useUi.getState().setPanel({ open: true, kind: 'output' });
}
