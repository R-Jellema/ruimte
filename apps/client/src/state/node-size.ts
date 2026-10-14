import { nodeSizeOf, type NodeKind, type NodeSize, type NodeSizes } from '@ruimte/contracts';
import { currentEndpointId } from '@/state/keys';
import { serverInfoOf, type ServerInfo } from '@/state/server';

/*
 * The sizes a person gave new nodes on a machine. A window shows one project on one machine, so
 * outside a render the machine is that of the workspace on screen.
 */
export function machineNodeSizes(endpointId: string = currentEndpointId()): NodeSizes {
    return serverInfoOf(endpointId).nodeSizes;
}

/* The size a new node of a kind takes: the one a person gave the kind on the machine, else the built-in one. */
export function defaultNodeSize(kind: NodeKind, endpointId?: string): NodeSize {
    return nodeSizeOf(machineNodeSizes(endpointId), kind);
}

/* Whether the machine keeps a size per kind, which a machine from before it does not. */
export function keepsNodeSizes(info: Pick<ServerInfo, 'features'>): boolean {
    return info.features?.includes('endpoint.setNodeSize') === true;
}
