import { nodesOfView } from '@/project/view-nodes';
import { useDocument } from '@/state/document';
import { currentEndpointId, endpointOfNode } from '@/state/keys';

/*
 * The machine a node or a view of the open project runs on, for code that has no subtree to ask:
 * the one a node names, else the workspace's. A view of its own always runs on the workspace's machine.
 */
export function endpointOfNodeId(nodeId: string): string {
    for (const view of useDocument.getState().views) {
        const node = nodesOfView(view).find((candidate) => candidate.id === nodeId);
        if (node !== undefined) {
            return endpointOfNode(node, currentEndpointId());
        }
    }
    return currentEndpointId();
}
