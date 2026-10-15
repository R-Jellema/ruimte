import { z } from 'zod';
import { RuntimeModeSchema } from './model.ts';
import { ProjectEdgeSchema, ProjectNodeSchema } from './project.ts';

/*
 * A project on this machine that another machine of the same account works in. This machine keeps the
 * link, and nothing happens for a machine without one: a person on this machine makes it.
 */
export const PeerLinkSchema = z.object({
    machineId: z.string().min(1).max(256),
    // What the other machine called itself when the link was made, for the list in settings.
    label: z.string().min(1).max(120),
    projectId: z.string().min(1).max(256),
    projectName: z.string().max(256),
    // The widest mode an agent from the other machine may start in here.
    ceiling: RuntimeModeSchema,
    createdAt: z.number().int().nonnegative(),
    lastUsedAt: z.number().int().nonnegative().optional(),
    // Until when the address book vouches for that machine working here; past it the machine has to be linked from its side again. Absent when it never did.
    attestedUntil: z.number().int().nonnegative().optional()
});
export type PeerLink = z.infer<typeof PeerLinkSchema>;

export const PeerListResultSchema = z.object({ links: z.array(PeerLinkSchema).max(1000) });
export type PeerListResult = z.infer<typeof PeerListResultSchema>;

// A project that is not on this machine answers `project-not-found`. Without a `ceiling` a new link is `supervised`.
export const PeerBindPayloadSchema = PeerLinkSchema.pick({ machineId: true, label: true, projectId: true }).extend({
    ceiling: RuntimeModeSchema.optional()
});
export type PeerBindPayload = z.infer<typeof PeerBindPayloadSchema>;

export const PeerSetCeilingPayloadSchema = PeerLinkSchema.pick({ machineId: true, projectId: true, ceiling: true });
export type PeerSetCeilingPayload = z.infer<typeof PeerSetCeilingPayloadSchema>;

export const PeerUnbindPayloadSchema = PeerLinkSchema.pick({ machineId: true, projectId: true });
export type PeerUnbindPayload = z.infer<typeof PeerUnbindPayloadSchema>;

/*
 * A node of another machine as it is drawn here. Only what a node needs to start on this machine: the
 * session of the other machine (`resume`) and its accounts mean nothing here, and its position is
 * the other canvas's.
 */
export const PeerNodeSchema = z.object({
    id: ProjectNodeSchema.shape.id,
    kind: z.enum(['terminal', 'chat', 'device']),
    title: ProjectNodeSchema.shape.title.max(200),
    cwd: ProjectNodeSchema.shape.cwd,
    command: ProjectNodeSchema.shape.command,
    provider: ProjectNodeSchema.shape.provider,
    providerFixed: ProjectNodeSchema.shape.providerFixed,
    runtimeMode: ProjectNodeSchema.shape.runtimeMode,
    accent: ProjectNodeSchema.shape.accent,
    issue: ProjectNodeSchema.shape.issue,
    device: ProjectNodeSchema.shape.device
});
export type PeerNode = z.infer<typeof PeerNodeSchema>;

/*
 * Everything of one machine's nodes in one project, which replaces what this machine drew for it
 * before. Errors: `peer-not-linked`, `cwd-outside` for a folder beyond the project and its worktrees,
 * and `edge-off-machine` for a line with an end that is not among the nodes.
 */
export const PeerPlaceNodesPayloadSchema = PeerLinkSchema.pick({ machineId: true, projectId: true }).extend({
    nodes: z.array(PeerNodeSchema).max(200),
    edges: z.array(ProjectEdgeSchema).max(400)
});
export type PeerPlaceNodesPayload = z.infer<typeof PeerPlaceNodesPayloadSchema>;
