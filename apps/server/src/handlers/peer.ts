import { isDeepStrictEqual } from 'node:util';
import {
    NODE_SIZE,
    isCanvasView,
    sessionNodesOfView,
    type PeerLink,
    type PeerNode,
    type ProjectCanvasView,
    type ProjectNode,
    type ProjectView
} from '@ruimte/contracts';
import { VerbRefusal } from '../canvas/verb.ts';
import { checkCwd } from '../canvas/project-paths.ts';
import { RequestError, type Dispatcher } from '../dispatcher.ts';
import { peerCanvasId, type PeerLinks } from '../peering/links.ts';
import type { ProjectStore } from '../projects/project-store.ts';

/* What the requests of another machine's links reach of this one. */
export interface PeerHost {
    links: PeerLinks;
    projects: Pick<ProjectStore, 'known' | 'read' | 'mutate' | 'hold'> & { index: Pick<ProjectStore['index'], 'folderOf'> };
    /* Ends the shell or the CLI behind a node, the way deleting the node does. */
    endSession(kind: 'terminal' | 'chat', nodeId: string): Promise<void>;
    /* The worktrees of the repository in a project folder, which a node may start in as well. */
    worktreePaths(folder: string): Promise<string[]>;
}

// The mirror is never looked at, so its nodes only need a place of their own and a size that holds.
const COLUMNS = 3;
const GAP = 40;

function nodeOf(node: PeerNode, index: number): ProjectNode {
    const { w, h } = NODE_SIZE[node.kind];
    return { ...node, x: (index % COLUMNS) * (w + GAP), y: Math.floor(index / COLUMNS) * (h + GAP), w, h };
}

/*
 * The links other machines have to projects here. Any client may make, change and remove one, since a
 * person on any client of the account is a person on this machine as far as its projects go. An agent
 * has no socket, so it never reaches these.
 */
export function registerPeerHandlers(dispatcher: Dispatcher, { links, projects, endSession, worktreePaths }: PeerHost): void {
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

    /*
     * The nodes another machine draws on its canvas for this one, kept on a canvas of their own so this
     * machine's rules reach them like any node: folders, modes, launch approvals and lines. The
     * window that asks holds the project from then on, but starts none of its autostart launches: only a person opening it does.
     */
    dispatcher.register('peer.placeNodes', async (payload, client) => {
        const { machineId, projectId, nodes, edges } = payload;
        const link = links.linkOf(machineId, projectId);
        if (link === null) {
            throw new RequestError('peer-not-linked', 'That machine has no link to this project');
        }
        const ids = new Set(nodes.map((node) => node.id));
        if (edges.some((edge) => !ids.has(edge.from) || !ids.has(edge.to))) {
            throw new RequestError('edge-off-machine', 'A line may only join two nodes of the same machine');
        }
        const folder = projects.index.folderOf(projectId);
        if (folder === null) {
            throw new RequestError('project-not-found', `No project ${projectId} is on this machine`);
        }
        for (const node of nodes) {
            if (node.cwd !== undefined) {
                await checkCwd(folder, node.cwd, worktreePaths).catch((e: unknown) => {
                    throw e instanceof VerbRefusal ? new RequestError('cwd-outside', e.message) : e;
                });
            }
        }
        const canvasId = peerCanvasId(machineId);
        const before = (await projects.read(projectId)).views.find((view): view is ProjectCanvasView => view.id === canvasId && isCanvasView(view));
        const canvas: ProjectCanvasView = {
            kind: 'canvas',
            id: canvasId,
            name: link.label,
            nodes: nodes.map(nodeOf),
            texts: [],
            edges,
            layouts: before?.layouts ?? []
        };
        await projects.mutate(projectId, (current) => {
            // A node of this machine's own with the same id would fail every flush of the other machine, so it is told apart here.
            const taken = current.views.find(
                (view) => view.id !== canvasId && (ids.has(view.id) || (isCanvasView(view) && view.nodes.some((node) => ids.has(node.id))))
            );
            if (taken !== undefined) {
                throw new RequestError('peer-node-taken', 'A node of that machine has the id of a view or node here');
            }
            const held = current.views.find((view) => view.id === canvasId);
            if (held !== undefined && sameCanvas(held, canvas)) {
                return { content: null, result: null };
            }
            const views = held === undefined ? [...current.views, canvas] : current.views.map((view) => (view.id === canvasId ? canvas : view));
            return { content: { ...current, views }, result: null };
        });
        // A node the other machine no longer draws ends like a deleted one, once the write that drops it landed.
        for (const gone of (before?.nodes ?? []).filter((node) => !ids.has(node.id))) {
            if (gone.kind === 'terminal' || gone.kind === 'chat') {
                await endSession(gone.kind, gone.id);
            }
        }
        await links.touch(machineId, projectId);
        if (!client.closed) {
            // Holding keeps the project loaded for these nodes; only a person opening it starts its autostart launches.
            projects.hold(client.id, projectId, { startsLaunches: false });
        }
        return {};
    });
}

/* Hidden is laid over the document and is no part of what the other machine drew. */
function sameCanvas(held: ProjectView, next: ProjectCanvasView): boolean {
    const { hidden: _hidden, ...rest } = held as ProjectCanvasView;
    return isDeepStrictEqual(rest, next);
}
