import type { RequestType } from '@ruimte/contracts';
import { useEndpointConnection } from './status';
import type { ConnectionState } from './transport';

/*
 * Whether the machine behind a link names this request in its `endpoint.info`. False while the link has
 * not opened yet, so a caller that needs the answer waits for the connection. Check any request newer
 * than 0.18.0 here before sending it; never catch `unknown-request`.
 */
export function machineAnswers(connection: Pick<ConnectionState, 'features'> | undefined, type: RequestType): boolean {
    return connection?.features?.includes(type) ?? false;
}

export function useMachineAnswers(endpointId: string, type: RequestType): boolean {
    return machineAnswers(useEndpointConnection(endpointId), type);
}
