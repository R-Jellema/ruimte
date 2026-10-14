import type { ProjectNode, ProjectView } from '@ruimte/contracts';
import type { ForkShape } from '@adecore/agents-react/chat';
import type { NodesOfView } from '@/project/view-nodes';

/* Where a chat stands in the project: a node on a canvas or a view of its own, under the name it goes by. */
export interface ForkOrigin {
    shape: ForkShape;
    title: string;
}

export function forkOriginIn(
    views: readonly ProjectView[],
    nodesOf: NodesOfView<Pick<ProjectNode, 'id' | 'kind' | 'title'>>,
    chatId: string
): ForkOrigin | null {
    for (const view of views) {
        if (view.kind === 'chat' && view.id === chatId) {
            return { shape: 'view', title: view.name };
        }
        const node = nodesOf(view).find((candidate) => candidate.id === chatId && candidate.kind === 'chat');
        if (node) {
            return { shape: 'node', title: node.title };
        }
    }
    return null;
}
