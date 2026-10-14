import type { BackgroundServiceBridge } from '@/desktop/bridge';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { protocolRefusal } from '@/transport/protocol';
import type { ConnectionState } from '@/transport/transport';

/* Whether the link of the workspace's machine is down and at least one try to bring it back failed; a link that is merely opening says nothing yet. */
export function machineLost(connection: Pick<ConnectionState, 'status' | 'attempts' | 'failure'>): boolean {
    return connection.status !== 'open' && (connection.attempts > 0 || Boolean(connection.failure));
}

/*
 * Whether the lost screen offers to restart this computer's own machine: it was refused as older,
 * which is the service still running the build from before an update that a person put off, and
 * the shell carries a restart out.
 */
export function offersMachineRestart(
    endpointId: string,
    connection: Pick<ConnectionState, 'failure'>,
    bridge: Pick<BackgroundServiceBridge, 'restartNow'> | null
): boolean {
    return endpointId === LOCAL_ENDPOINT_ID && bridge?.restartNow !== undefined && connection.failure === protocolRefusal('daemon-older');
}
