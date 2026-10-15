import { useRemoteRefusals } from '@/project/remote-refusals';
import { useEndpoints } from '@/state/endpoints';
import { machineAnswers } from '@/transport/features';
import { useEndpointConnection } from '@/transport/status';
import type { ConnectionState } from '@/transport/transport';

/*
 * What a node that runs on another machine can do right now. `ready` is the usual body, loading
 * included; the others replace the body with a card that says why, since drawing a terminal or a
 * thread from a machine that is not there only shows an error in it.
 */
export type RemoteNodeState = 'ready' | 'connecting' | 'offline' | 'unlinked' | 'too-old';

export function remoteNodeStateOf(input: {
    known: boolean;
    connection: Pick<ConnectionState, 'status' | 'attempts' | 'failure' | 'features'>;
    unlinked: boolean;
}): RemoteNodeState {
    const { known, connection, unlinked } = input;
    if (!known) {
        return 'offline';
    }
    if (connection.status !== 'open') {
        // A link that has not tried yet is a node that is still loading, not one that is lost.
        if (connection.attempts === 0 && !connection.failure) {
            return 'ready';
        }
        return connection.status === 'connecting' ? 'connecting' : 'offline';
    }
    if (!machineAnswers(connection, 'peer.placeNodes')) {
        return 'too-old';
    }
    return unlinked ? 'unlinked' : 'ready';
}

/* The state of a node's machine; `ready` for a node that runs on the workspace's own. */
export function useRemoteNodeState(machine: string | undefined, workspaceId: string | undefined): RemoteNodeState {
    const remote = machine !== undefined && machine !== workspaceId ? machine : null;
    const connection = useEndpointConnection(remote ?? '');
    const rows = useEndpoints((state) => state.endpoints);
    const unlinked = useRemoteRefusals((state) => (remote === null ? false : state.unlinked[remote] === true));
    if (remote === null) {
        return 'ready';
    }
    return remoteNodeStateOf({ known: rows.some((row) => row.id === remote), connection, unlinked });
}
