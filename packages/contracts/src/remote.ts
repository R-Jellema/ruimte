import { z } from 'zod';

/*
 * The checkout on another machine a project here is linked to. This machine keeps it under its own
 * home, since where a project lives on another machine is nothing a team commits.
 */
export const RemoteLinkSchema = z.object({
    machineId: z.string().min(1).max(256),
    // The project on that machine, which a person linked there with `peer.bind`.
    remoteProjectId: z.string().min(1).max(256),
    // What that machine is called, for the menu and the offline card.
    label: z.string().min(1).max(120),
    // The first commit of the repository both checkouts hold, which is how they are told to be one.
    rootCommit: z.string().max(128)
});
export type RemoteLink = z.infer<typeof RemoteLinkSchema>;

export const RemoteListPayloadSchema = z.object({ projectId: z.string().min(1).max(256) });
export type RemoteListPayload = z.infer<typeof RemoteListPayloadSchema>;

export const RemoteListResultSchema = z.object({ links: z.array(RemoteLinkSchema).max(100) });
export type RemoteListResult = z.infer<typeof RemoteListResultSchema>;

// Linking a machine that is linked already replaces its link. A project that is not here answers `project-not-found`.
export const RemoteLinkPayloadSchema = RemoteLinkSchema.extend({ projectId: z.string().min(1).max(256) });
export type RemoteLinkPayload = z.infer<typeof RemoteLinkPayloadSchema>;

// Refused with `machine-in-use` while a node of the project still runs on that machine.
export const RemoteUnlinkPayloadSchema = RemoteLinkPayloadSchema.pick({ projectId: true, machineId: true });
export type RemoteUnlinkPayload = z.infer<typeof RemoteUnlinkPayloadSchema>;
