import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RemoteLink } from '@ruimte/contracts';
import { MachineGlyph } from '@/endpoint/MachineGlyph';
import type { Point } from '@/canvas/math';
import { usePulsarAccount } from '@/pulsar/account';
import { usePulsarMachines } from '@/pulsar/machines';
import { iconOfEntry } from '@/shell/settings/machine-icon';
import { machineIdOf, mergeMachines, nameOf, type MachineEntry } from '@/shell/settings/machine-list';
import { useCanvasStore } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { useEndpoints } from '@/state/endpoints';
import { hasLocalMachine } from '@/state/local-machine';
import { useProjectList } from '@/state/project-list';
import { useProject } from '@/state/project';
import { useServers } from '@/state/server';
import { useUi } from '@/state/ui';
import { useWorkspace } from '@/transport/connections';
import { machineAnswers } from '@/transport/features';
import { useEndpointConnection } from '@/transport/status';
import { machineLost } from '@/shell/machine-lost';
import { ContextMenu, DisabledReason } from '@adecore/ui';

/* The machines other than the one the project lives on, which a node can be put on. */
function useOtherMachines(): MachineEntry[] {
    const workspace = useWorkspace();
    const endpoints = useEndpoints((s) => s.endpoints);
    const accountStatus = usePulsarAccount((s) => s.status);
    const accountMachines = usePulsarMachines((s) => s.machines);
    const own = workspace === null ? null : endpoints.find((endpoint) => endpoint.id === workspace.connection.endpointId);
    return mergeMachines({ endpoints, accountMachines: accountStatus === 'signed-in' ? accountMachines : null, showLocal: hasLocalMachine() }).filter(
        (entry) => entry.endpoint?.id !== own?.id && entry.id !== (own === undefined || own === null ? null : machineIdOf(own))
    );
}

/* The checkouts this project is linked to on the machines, so a row can say which one it would work in. */
function useLinks(): RemoteLink[] {
    const workspace = useWorkspace();
    const projectId = useProject((s) => s.current?.projectId ?? null);
    const [links, setLinks] = useState<RemoteLink[]>([]);
    useEffect(() => {
        if (workspace === null || projectId === null) {
            return;
        }
        let current = true;
        workspace.connection.transport.request('remote.list', { projectId }).then(
            (answer) => current && setLinks(answer.links),
            () => undefined
        );
        return () => {
            current = false;
        };
    }, [workspace, projectId]);
    return links;
}

/*
 * "On another machine": one row per machine of the account, below the node kinds. A node of another
 * machine goes on a canvas only you have, so on a shared canvas the group says why it is off.
 */
export function RemoteMachineItems({ at }: { at: () => Point }) {
    const { t } = useTranslation('canvas');
    const canvasStore = useCanvasStore();
    const viewId = canvasStore.getState().viewId;
    const shared = useDocument((s) => viewId !== null && s.shared.includes(viewId));
    const machines = useOtherMachines();
    const links = useLinks();
    if (machines.length === 0 || viewId === null) {
        return null;
    }
    return (
        <>
            <ContextMenu.Separator />
            <ContextMenu.Label>{t('otherMachine.group')}</ContextMenu.Label>
            {machines.map((entry) => (
                <MachineRow
                    key={entry.id}
                    entry={entry}
                    shared={shared}
                    link={links.find((known) => known.machineId === entry.id) ?? null}
                    onPick={() => {
                        useUi.getState().setRemoteNodeDialog({ machineId: entry.id, kind: 'chat', viewId, at: at(), relink: false });
                    }}
                />
            ))}
        </>
    );
}

function MachineRow({ entry, shared, link, onPick }: { entry: MachineEntry; shared: boolean; link: RemoteLink | null; onPick(): void }) {
    const { t } = useTranslation('canvas');
    const endpointId = entry.endpoint?.id ?? entry.id;
    const connection = useEndpointConnection(endpointId);
    const answered = useServers((s) => s.byEndpoint[endpointId]?.icon ?? null);
    const remoteName = useProjectList((s) =>
        link === null ? null : (s.projects.find((row) => row.endpointId === endpointId && row.summary.projectId === link.remoteProjectId)?.summary.name ?? null)
    );
    const name = nameOf(entry);
    const tooOld = connection.status === 'open' && !machineAnswers(connection, 'peer.placeNodes');
    const reason = shared ? t('otherMachine.shared') : tooOld ? t('otherMachine.needsUpdateTip', { machine: name }) : null;
    const second = tooOld ? t('otherMachine.needsUpdate') : machineLost(connection) ? t('otherMachine.notAnswering') : remoteName;
    return (
        <DisabledReason reason={reason}>
            <ContextMenu.Item disabled={shared || tooOld} onClick={onPick}>
                <MachineGlyph icon={iconOfEntry(entry, answered)} size={14} />
                <span className="flex min-w-0 flex-col">
                    <span className="truncate">{name}</span>
                    {second !== null && <span className="truncate text-xs text-text-muted">{second}</span>}
                </span>
            </ContextMenu.Item>
        </DisabledReason>
    );
}
