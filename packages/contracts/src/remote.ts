import { BrokerUrlSchema, PeerStatementSchema } from '@ruimte/pulsar';
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

/*
 * The statement the address book signed for this machine to work in `machineId`, handed over by the page
 * that asked for it. The machine opens the link with it once and proves its peer key from then on.
 */
export const RemoteConnectPayloadSchema = z.object({
    machineId: z.string().min(1).max(256),
    statement: PeerStatementSchema,
    // The broker that machine announces itself to, as the address book lists it; absent is the broker this machine uses itself.
    brokerUrl: BrokerUrlSchema.nullable().optional()
});
export type RemoteConnectPayload = z.infer<typeof RemoteConnectPayloadSchema>;

/*
 * Where the link to another machine stands, to every client, on each change and once for every machine
 * a client has not heard of yet. `waiting` is a link that failed while work for that machine is owed,
 * which tries again at `nextAttemptAt`; a link nothing is owed for just closes (`closed`).
 */
export const RemoteStatusEventSchema = z.object({
    machineId: z.string().min(1).max(256),
    state: z.enum(['open', 'connecting', 'waiting', 'closed']),
    // How many pieces of work for that machine wait on the link.
    owed: z.number().int().min(0),
    nextAttemptAt: z.number().int().min(0).optional()
});
export type RemoteStatusEvent = z.infer<typeof RemoteStatusEventSchema>;
