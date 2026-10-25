import { z } from 'zod';

/*
 * Output: what a person or an agent saved of a project's work, kept by the machine under
 * `$RUIMTE_HOME/artifacts` and outside any project. A version is an immutable snapshot; the same
 * output key makes a new version of the same artifact.
 */

export const ARTIFACT_KINDS = ['report', 'image', 'build', 'export', 'recording', 'page'] as const;
export const ArtifactKindSchema = z.enum(ARTIFACT_KINDS);
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;

export const ARTIFACT_LIMITS = {
    // Every file of one version together.
    versionBytes: 2 * 1024 * 1024 * 1024,
    filesPerVersion: 64,
    titleLength: 200,
    fileNameLength: 255
} as const;

// Ids the machine makes; a client only ever hands one back.
export const ArtifactIdSchema = z.string().regex(/^art-[a-z0-9]{8,32}$/);
export const ArtifactVersionIdSchema = z.string().regex(/^ver-[a-z0-9]{8,32}$/);

export const ARTIFACT_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const ArtifactKeySchema = z.string().regex(ARTIFACT_KEY_PATTERN);

// What a caller picks so a retry of the same save lands once.
export const ArtifactRequestIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export const ArtifactFileSchema = z.object({
    // A label and the name Copy to project suggests, never a path on disk.
    name: z.string().min(1).max(ARTIFACT_LIMITS.fileNameLength),
    mime: z.string().min(1),
    size: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/)
});
export type ArtifactFile = z.infer<typeof ArtifactFileSchema>;

/* Written by the machine from the context of the call that saved the version; nothing in it comes from an argument. */
export const ArtifactProvenanceSchema = z.object({
    maker: z.enum(['agent', 'person', 'routine']),
    machineId: z.string().min(1),
    chatId: z.string().min(1).optional(),
    turnId: z.string().min(1).optional(),
    taskId: z.string().min(1).optional(),
    nodeId: z.string().min(1).optional(),
    launchId: z.string().min(1).optional(),
    routineId: z.string().min(1).optional(),
    runId: z.string().min(1).optional()
});
export type ArtifactProvenance = z.infer<typeof ArtifactProvenanceSchema>;

/* A version copied from another machine: where it came from, as that machine recorded it. */
export const ArtifactOriginSchema = z.object({
    machineId: z.string().min(1),
    artifactId: ArtifactIdSchema,
    versionId: ArtifactVersionIdSchema,
    provenance: ArtifactProvenanceSchema,
    hashes: z.array(z.string().regex(/^[0-9a-f]{64}$/))
});
export type ArtifactOrigin = z.infer<typeof ArtifactOriginSchema>;

export const ArtifactVersionSchema = z.object({
    versionId: ArtifactVersionIdSchema,
    number: z.number().int().positive(),
    // Epoch ms.
    createdAt: z.number().int().nonnegative(),
    files: z.array(ArtifactFileSchema).min(1).max(ARTIFACT_LIMITS.filesPerVersion),
    // Every file together.
    bytes: z.number().int().nonnegative(),
    provenance: ArtifactProvenanceSchema,
    // The project paths it was copied to, relative to their project folder.
    copiedTo: z.array(z.string().min(1)),
    origin: ArtifactOriginSchema.optional()
});
export type ArtifactVersion = z.infer<typeof ArtifactVersionSchema>;

export const ArtifactSchema = z.object({
    artifactId: ArtifactIdSchema,
    projectId: z.string().min(1),
    // The name the project has now, or had when the artifact was made once the machine no longer knows it.
    projectName: z.string(),
    title: z.string().min(1).max(ARTIFACT_LIMITS.titleLength),
    kind: ArtifactKindSchema,
    key: ArtifactKeySchema.optional(),
    createdAt: z.number().int().nonnegative()
});
export type Artifact = z.infer<typeof ArtifactSchema>;

export const ArtifactSummarySchema = ArtifactSchema.extend({
    latest: ArtifactVersionSchema,
    versionCount: z.number().int().positive(),
    totalBytes: z.number().int().nonnegative()
});
export type ArtifactSummary = z.infer<typeof ArtifactSummarySchema>;

export const ArtifactListPayloadSchema = z.object({ projectId: z.string().min(1).optional(), chatId: z.string().min(1).optional() });
export type ArtifactListPayload = z.infer<typeof ArtifactListPayloadSchema>;

export const ArtifactListResultSchema = z.object({ artifacts: z.array(ArtifactSummarySchema) });
export type ArtifactListResult = z.infer<typeof ArtifactListResultSchema>;

export const ArtifactGetPayloadSchema = z.object({ artifactId: ArtifactIdSchema });
export type ArtifactGetPayload = z.infer<typeof ArtifactGetPayloadSchema>;

export const ArtifactGetResultSchema = z.object({
    artifact: ArtifactSchema,
    // Newest first.
    versions: z.array(ArtifactVersionSchema).min(1),
    // Whether the chat the latest version was made in is still on this machine; false for a version made outside a chat.
    chatPresent: z.boolean()
});
export type ArtifactGetResult = z.infer<typeof ArtifactGetResultSchema>;

export const ArtifactChangedEventSchema = z.object({
    artifactId: ArtifactIdSchema,
    projectId: z.string().min(1),
    removed: z.boolean().optional()
});
export type ArtifactChangedEvent = z.infer<typeof ArtifactChangedEventSchema>;

/* What a person saves from a chat: a page shown in it, an attachment of it, or an image a tool row of it shows. */
export const ArtifactSaveSourceSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('visual'), chatId: z.string().min(1), visualId: z.string().min(1) }),
    z.object({ kind: z.literal('attachment'), chatId: z.string().min(1), attachmentId: z.string().min(1) }),
    z.object({ kind: z.literal('image'), chatId: z.string().min(1), path: z.string().min(1).max(4096) })
]);
export type ArtifactSaveSource = z.infer<typeof ArtifactSaveSourceSchema>;

export const ArtifactSavePayloadSchema = z.object({
    projectId: z.string().min(1),
    title: z.string().trim().min(1).max(ARTIFACT_LIMITS.titleLength).optional(),
    kind: ArtifactKindSchema.optional(),
    key: ArtifactKeySchema.optional(),
    requestId: ArtifactRequestIdSchema,
    source: ArtifactSaveSourceSchema
});
export type ArtifactSavePayload = z.infer<typeof ArtifactSavePayloadSchema>;

export const ArtifactSaveResultSchema = z.object({ artifactId: ArtifactIdSchema, versionId: ArtifactVersionIdSchema });
export type ArtifactSaveResult = z.infer<typeof ArtifactSaveResultSchema>;

export const ArtifactCopyToProjectPayloadSchema = z.object({
    artifactId: ArtifactIdSchema,
    versionId: ArtifactVersionIdSchema,
    projectId: z.string().min(1),
    // Relative to the project folder; a version of several files goes into a folder of this name.
    path: z.string().min(1).max(4096)
});
export type ArtifactCopyToProjectPayload = z.infer<typeof ArtifactCopyToProjectPayloadSchema>;

export const ArtifactCopyToProjectResultSchema = z.object({ paths: z.array(z.string().min(1)) });
export type ArtifactCopyToProjectResult = z.infer<typeof ArtifactCopyToProjectResultSchema>;

export const ArtifactProjectStorageSchema = z.object({
    projectId: z.string().min(1),
    projectName: z.string(),
    artifacts: z.number().int().nonnegative(),
    versions: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative()
});
export type ArtifactProjectStorage = z.infer<typeof ArtifactProjectStorageSchema>;

export const ArtifactStorageResultSchema = z.object({
    projects: z.array(ArtifactProjectStorageSchema),
    total: z.object({ artifacts: z.number().int().nonnegative(), versions: z.number().int().nonnegative(), bytes: z.number().int().nonnegative() }),
    // The volume the artifacts are on; null when the machine cannot tell.
    disk: z.object({ free: z.number().int().nonnegative(), size: z.number().int().nonnegative() }).nullable()
});
export type ArtifactStorageResult = z.infer<typeof ArtifactStorageResultSchema>;

export const ArtifactVersionRefSchema = z.object({ artifactId: ArtifactIdSchema, versionId: ArtifactVersionIdSchema });
export type ArtifactVersionRef = z.infer<typeof ArtifactVersionRefSchema>;

export const ArtifactCleanupPayloadSchema = z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('preview') }),
    // Exactly these versions, checked again against what is never proposed.
    z.object({ mode: z.literal('confirm'), versions: z.array(ArtifactVersionRefSchema).min(1).max(10_000) })
]);
export type ArtifactCleanupPayload = z.infer<typeof ArtifactCleanupPayloadSchema>;

export const ArtifactCleanupProposalSchema = z.object({
    id: z.string().min(1),
    artifactId: ArtifactIdSchema,
    title: z.string(),
    versions: z.array(
        z.object({
            versionId: ArtifactVersionIdSchema,
            number: z.number().int().positive(),
            createdAt: z.number().int().nonnegative(),
            bytes: z.number().int().nonnegative()
        })
    ),
    bytes: z.number().int().nonnegative()
});
export type ArtifactCleanupProposal = z.infer<typeof ArtifactCleanupProposalSchema>;

// A preview answers `proposals`, a confirm `removed` and `freedBytes`.
export const ArtifactCleanupResultSchema = z.object({
    proposals: z.array(ArtifactCleanupProposalSchema).optional(),
    removed: z.number().int().nonnegative().optional(),
    freedBytes: z.number().int().nonnegative().optional()
});
export type ArtifactCleanupResult = z.infer<typeof ArtifactCleanupResultSchema>;
