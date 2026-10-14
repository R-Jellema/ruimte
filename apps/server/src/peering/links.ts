import { join } from 'node:path';
import { RuntimeModeSchema, isCanvasView, type PeerLink, type ProjectContent, type RuntimeMode } from '@ruimte/contracts';
import { RecordDirectory } from '@adecore/agents';
import { z } from 'zod';
import { ClientSinks } from '../client-sinks.ts';
import type { SessionSink } from '../sessions/manager.ts';

const LinkSchema = z.looseObject({
    projectId: z.string().min(1),
    ceiling: RuntimeModeSchema,
    createdAt: z.number().int().nonnegative(),
    lastUsedAt: z.number().int().nonnegative().optional()
});

const PeerFileSchema = z.looseObject({
    machineId: z.string().min(1),
    label: z.string().min(1),
    links: z.array(LinkSchema).default([])
});

type PeerFile = z.infer<typeof PeerFileSchema>;

/* What a link is until a person says otherwise: an agent from the other machine asks before it acts. */
export const DEFAULT_CEILING: RuntimeMode = 'supervised';

/* The canvas this machine keeps for the nodes of one other machine in a project. */
export function peerCanvasId(machineId: string): string {
    return `peer-${machineId}`;
}

/*
 * The document with exactly these canvases hidden. Hidden is not stored, as a node's machine is not:
 * it follows from a link here, so a project file never says which machines work in it.
 */
export function withHiddenCanvases<T extends ProjectContent>(content: T, hidden: ReadonlySet<string>): T {
    let changed = false;
    const views = content.views.map((view) => {
        if (!isCanvasView(view)) {
            return view;
        }
        const want = hidden.has(view.id);
        if (want ? view.hidden === true : view.hidden === undefined) {
            return view;
        }
        changed = true;
        const { hidden: _hidden, ...rest } = view;
        return want ? { ...rest, hidden: true as const } : rest;
    });
    return changed ? { ...content, views } : content;
}

/*
 * Which project here each other machine may work in, under `$RUIMTE_HOME/peers`. Only a person on a
 * client of this machine changes it, and an agent has no socket to do so. Nothing a machine asks for
 * is granted without a link in this store.
 */
export class PeerLinks {
    private readonly files: RecordDirectory<PeerFile>;
    private readonly sinks = new ClientSinks();
    private readonly clock: () => number;

    constructor(home: string, clock: () => number = Date.now) {
        this.files = new RecordDirectory({ dir: join(home, 'peers'), schema: PeerFileSchema, idOf: (file) => file.machineId });
        this.clock = clock;
    }

    /* Reads what an earlier run of the daemon wrote down. Call before any request is answered. */
    load(): Promise<void> {
        return this.files.load();
    }

    /* Every client hears when a link is made, changed or removed. */
    subscribe(clientId: string, sink: SessionSink): () => void {
        return this.sinks.subscribe(clientId, sink);
    }

    /* Every link, without the project name, which only the project registry knows. */
    list(): Array<Omit<PeerLink, 'projectName'>> {
        return this.files.all().flatMap((file) => file.links.map((link) => ({ ...link, machineId: file.machineId, label: file.label })));
    }

    linkOf(machineId: string, projectId: string): Omit<PeerLink, 'projectName'> | null {
        return this.list().find((link) => link.machineId === machineId && link.projectId === projectId) ?? null;
    }

    /* The canvases of this project that other machines' nodes live on. */
    canvasIdsOf(projectId: string): Set<string> {
        return new Set(
            this.files
                .all()
                .filter((file) => file.links.some((link) => link.projectId === projectId))
                .map((file) => peerCanvasId(file.machineId))
        );
    }

    /* Making a link that exists changes its label and, when one is given, its ceiling. */
    async bind(machineId: string, label: string, projectId: string, ceiling?: RuntimeMode): Promise<Omit<PeerLink, 'projectName'>> {
        const file = this.files.get(machineId);
        const held = file?.links.find((link) => link.projectId === projectId);
        const link = { ...held, projectId, ceiling: ceiling ?? held?.ceiling ?? DEFAULT_CEILING, createdAt: held?.createdAt ?? this.clock() };
        await this.write({ ...file, machineId, label, links: [...(file?.links.filter((other) => other.projectId !== projectId) ?? []), link] });
        return { ...link, machineId, label };
    }

    /* False when there is no such link. */
    async setCeiling(machineId: string, projectId: string, ceiling: RuntimeMode): Promise<boolean> {
        const file = this.files.get(machineId);
        if (!file?.links.some((link) => link.projectId === projectId)) {
            return false;
        }
        await this.write({ ...file, links: file.links.map((link) => (link.projectId === projectId ? { ...link, ceiling } : link)) });
        return true;
    }

    /* Notes that the other machine did something here; nobody hears of it, since a list that reloads on every request is no list. */
    async touch(machineId: string, projectId: string): Promise<void> {
        const file = this.files.get(machineId);
        if (!file?.links.some((link) => link.projectId === projectId)) {
            return;
        }
        await this.files.write({ ...file, links: file.links.map((link) => (link.projectId === projectId ? { ...link, lastUsedAt: this.clock() } : link)) });
    }

    /* False when there is no such link. A machine with no link left has no file. */
    async unbind(machineId: string, projectId: string): Promise<boolean> {
        const file = this.files.get(machineId);
        if (!file?.links.some((link) => link.projectId === projectId)) {
            return false;
        }
        const links = file.links.filter((link) => link.projectId !== projectId);
        if (links.length === 0) {
            await this.files.remove(machineId);
            this.sinks.emit({ event: 'peer.changed', payload: {} });
            return true;
        }
        await this.write({ ...file, links });
        return true;
    }

    /* Every link of a project that is gone goes with it. */
    async forgetProject(projectId: string): Promise<void> {
        for (const file of this.files.all().filter((candidate) => candidate.links.some((link) => link.projectId === projectId))) {
            await this.unbind(file.machineId, projectId);
        }
    }

    private async write(file: PeerFile): Promise<void> {
        await this.files.write(file);
        this.sinks.emit({ event: 'peer.changed', payload: {} });
    }
}
