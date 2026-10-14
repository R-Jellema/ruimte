import { sessionNodesOfView, type PeerLink } from '@ruimte/contracts';
import { RequestError, type Dispatcher } from '../dispatcher.ts';
import { peerCanvasId, type PeerLinks } from '../peering/links.ts';
import type { ProjectStore } from '../projects/project-store.ts';

/* What the requests of another machine's links reach of this one. */
export interface PeerHost {
    links: PeerLinks;
    projects: Pick<ProjectStore, 'known' | 'read' | 'mutate'>;
    /* Ends the shell or the CLI behind a node, the way deleting the node does. */
    endSession(kind: 'terminal' | 'chat', nodeId: string): Promise<void>;
}

/*
 * The links other machines have to projects here. Any client may make, change and remove one, since a
 * person on any client of the account is a person on this machine as far as its projects go. An agent
 * has no socket, so it never reaches these.
 */
export function registerPeerHandlers(dispatcher: Dispatcher, { links, projects, endSession }: PeerHost): void {
    const namesOf = async (): Promise<Map<string, string>> => new Map((await projects.known()).map((project) => [project.projectId, project.name]));

    const withName = (link: Omit<PeerLink, 'projectName'>, names: ReadonlyMap<string, string>): PeerLink => ({
        ...link,
        projectName: names.get(link.projectId) ?? ''
    });

    dispatcher.register('peer.list', async () => {
        const names = await namesOf();
        return { links: links.list().map((link) => withName(link, names)) };
    });

    dispatcher.register('peer.bind', async (payload) => {
        const names = await namesOf();
        if (!names.has(payload.projectId)) {
            throw new RequestError('project-not-found', `No project ${payload.projectId} is on this machine`);
        }
        return withName(await links.bind(payload.machineId, payload.label, payload.projectId, payload.ceiling), names);
    });

    dispatcher.register('peer.setCeiling', async (payload) => {
        if (!(await links.setCeiling(payload.machineId, payload.projectId, payload.ceiling))) {
            throw new RequestError('peer-not-linked', 'That machine has no link to this project');
        }
        return {};
    });

    /* The nodes of that machine end first, as a deleted node's do, and then their canvas and the link go. */
    dispatcher.register('peer.unbind', async (payload) => {
        if (links.linkOf(payload.machineId, payload.projectId) === null) {
            throw new RequestError('peer-not-linked', 'That machine has no link to this project');
        }
        const canvasId = peerCanvasId(payload.machineId);
        const content = await projects.read(payload.projectId).catch(() => null);
        const canvas = content?.views.find((view) => view.id === canvasId);
        if (canvas !== undefined) {
            for (const node of sessionNodesOfView(canvas)) {
                await endSession(node.kind, node.id);
            }
            await projects.mutate(payload.projectId, (current) => ({
                content: { ...current, views: current.views.filter((view) => view.id !== canvasId) },
                result: null
            }));
        }
        await links.unbind(payload.machineId, payload.projectId);
        return {};
    });
}
