import { create } from 'zustand';
import { artifactTabKey, openArtifactTab, useFiles } from '@/state/files';
import { useSettings } from '@/state/settings';
import { useUi } from '@/state/ui';

/* The version each open artifact view shows, by tab key; absent follows the latest. */
export const useArtifactSelection = create<{ versions: Readonly<Record<string, string>> }>(() => ({ versions: {} }));

export function selectArtifactVersion(artifactId: string, versionId: string | null, machineId?: string): void {
    const key = artifactTabKey(artifactId, machineId);
    useArtifactSelection.setState((state) => {
        const { [key]: _was, ...rest } = state.versions;
        return { versions: versionId === null ? rest : { ...rest, [key]: versionId } };
    });
}

/*
 * An artifact as a loose view of the window's project, the way a file opens from the files panel;
 * `machineId` names another machine of the account it is kept on.
 */
export function openArtifact(artifactId: string, title: string, versionId: string | null = null, machineId?: string): void {
    selectArtifactVersion(artifactId, versionId, machineId);
    const files = useFiles.getState();
    files.show(openArtifactTab(files, artifactId, title, machineId), useSettings.getState().filesTabLimit);
}

/* The base version an opening asked a view to compare with, by tab key; the view takes it as it draws. */
export const useArtifactCompareRequest = create<{ bases: Readonly<Record<string, string>> }>(() => ({ bases: {} }));

export function takeCompareRequest(key: string): void {
    useArtifactCompareRequest.setState((state) => {
        const { [key]: _taken, ...rest } = state.bases;
        return { bases: rest };
    });
}

/* An artifact opened on one version with Compare on against another, as a run compares with the run before it. */
export function openArtifactCompared(artifactId: string, title: string, versionId: string, baseVersionId: string): void {
    const key = artifactTabKey(artifactId);
    useArtifactCompareRequest.setState((state) => ({ bases: { ...state.bases, [key]: baseVersionId } }));
    openArtifact(artifactId, title, versionId);
}

/* A project the panel is asked to show, taken by the panel when it draws; null once taken. */
export const useOutputRequest = create<{ project: { projectId: string } | null }>(() => ({ project: null }));

/* Output in the panel of the window, from a chat or anywhere else that points at it. */
export function showOutputPanel(): void {
    useUi.getState().setPanel({ open: true, kind: 'output' });
}

/* The panel filtered to one project of the window's machine. */
export function showProjectOutput(projectId: string): void {
    useOutputRequest.setState({ project: { projectId } });
    showOutputPanel();
}
