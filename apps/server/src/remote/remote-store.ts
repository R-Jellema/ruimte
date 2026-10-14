import { join } from 'node:path';
import { isCanvasView, type ProjectContent, type ProjectNode, type ProjectView } from '@ruimte/contracts';
import { RecordDirectory } from '@adecore/agents';
import { z } from 'zod';

/*
 * Loose, so a file a newer daemon wrote keeps its other keys. `links` is kept as it was read: the code
 * that makes links owns their shape.
 */
const RemoteFileSchema = z.looseObject({
    projectId: z.string().min(1),
    links: z.array(z.unknown()).default([]),
    // Node id to the daemon id of the machine the node runs on.
    nodes: z.record(z.string().min(1), z.string().min(1)).default({})
});

type RemoteFile = z.infer<typeof RemoteFileSchema>;

/*
 * Which node of which project runs on another machine, under `$RUIMTE_HOME/remote`. Never in a project
 * file: a saved file is one a colleague can push, a client of an older release drops a field it does not
 * know, and an agent with a shell can rewrite it. Only a person's `project.save` sets a binding.
 */
export class RemoteStore {
    private readonly files: RecordDirectory<RemoteFile>;

    constructor(home: string) {
        this.files = new RecordDirectory({ dir: join(home, 'remote'), schema: RemoteFileSchema, idOf: (file) => file.projectId });
    }

    /* Reads what an earlier run of the daemon wrote down. Call before any session is made. */
    load(): Promise<void> {
        return this.files.load();
    }

    nodesOf(projectId: string): Readonly<Record<string, string>> {
        return this.files.get(projectId)?.nodes ?? {};
    }

    machineOf(projectId: string, nodeId: string): string | null {
        const nodes = this.nodesOf(projectId);
        return Object.hasOwn(nodes, nodeId) ? nodes[nodeId]! : null;
    }

    /*
     * Sets what a person's save named and drops every binding whose node is gone from the document.
     * A node the save did not name keeps its binding, which is what an older client's save amounts to.
     */
    async apply(projectId: string, asked: ReadonlyMap<string, string>, alive: ReadonlySet<string>): Promise<void> {
        const file = this.files.get(projectId);
        const nodes = { ...file?.nodes };
        for (const [nodeId, machineId] of asked) {
            if (alive.has(nodeId)) {
                nodes[nodeId] = machineId;
            }
        }
        for (const nodeId of Object.keys(nodes)) {
            if (!alive.has(nodeId)) {
                delete nodes[nodeId];
            }
        }
        const changed =
            Object.keys(nodes).length !== Object.keys(file?.nodes ?? {}).length ||
            Object.entries(nodes).some(([nodeId, machineId]) => file?.nodes[nodeId] !== machineId);
        if (!changed) {
            return;
        }
        if (Object.keys(nodes).length === 0 && (file?.links.length ?? 0) === 0) {
            await this.files.remove(projectId);
            return;
        }
        await this.files.write({ ...file, projectId, links: file?.links ?? [], nodes });
    }

    /* The project is gone, and its bindings with it. */
    forget(projectId: string): Promise<void> {
        return this.files.remove(projectId);
    }
}

function mapNodes<T extends ProjectContent>(content: T, map: (node: ProjectNode) => ProjectNode): T {
    return { ...content, views: content.views.map((view: ProjectView) => (isCanvasView(view) ? { ...view, nodes: view.nodes.map(map) } : view)) };
}

/* Only a node on a canvas runs elsewhere; a view of its own is a node without a frame and never does. */
export function canvasNodeIdsOf(content: ProjectContent): Set<string> {
    const ids = new Set<string>();
    for (const view of content.views) {
        if (isCanvasView(view)) {
            for (const node of view.nodes) {
                ids.add(node.id);
            }
        }
    }
    return ids;
}

export function machinesOf(content: ProjectContent): Map<string, string> {
    const machines = new Map<string, string>();
    for (const view of content.views) {
        if (isCanvasView(view)) {
            for (const node of view.nodes) {
                if (node.machine !== undefined) {
                    machines.set(node.id, node.machine);
                }
            }
        }
    }
    return machines;
}

/* The document as it goes on the wire: every bound node names its machine. */
export function withMachines<T extends ProjectContent>(content: T, nodes: Readonly<Record<string, string>>): T {
    if (Object.keys(nodes).length === 0) {
        return content;
    }
    return mapNodes(content, (node) => (Object.hasOwn(nodes, node.id) ? { ...node, machine: nodes[node.id]! } : node));
}

/* A change from a verb or an outside edit keeps the machines the store holds and drops every other one. */
export function withBoundMachines<T extends ProjectContent>(content: T, nodes: Readonly<Record<string, string>>): T {
    return mapNodes(content, (node) => {
        if (node.machine === undefined || (Object.hasOwn(nodes, node.id) && nodes[node.id] === node.machine)) {
            return node;
        }
        const { machine: _machine, ...rest } = node;
        return rest as ProjectNode;
    });
}

export function withoutMachines<T extends ProjectContent>(content: T): T {
    return withBoundMachines(content, {});
}
