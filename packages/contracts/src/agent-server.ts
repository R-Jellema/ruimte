import { z } from 'zod';
import { AgentKindSchema } from './agent.ts';

/*
 * The server a CLI runs its chat on when that server is a download of its own rather than the CLI,
 * pinned in the daemon to one version and checksum per platform. `unsupported` is a platform the pin has no build for.
 */
export const AgentServerStatusSchema = z.object({
    provider: AgentKindSchema,
    state: z.enum(['missing', 'installing', 'installed', 'failed', 'unsupported']),
    // The version the daemon pins, which Install puts in place.
    version: z.string(),
    // The version that is unpacked and verified here; null before the first Install.
    installed: z.string().nullable(),
    // Why the last Install failed, while the state is `failed`.
    error: z.string().optional()
});
export type AgentServerStatus = z.infer<typeof AgentServerStatusSchema>;

export const AgentServerPayloadSchema = z.object({ provider: AgentKindSchema });
export const AgentServerResultSchema = z.object({ server: AgentServerStatusSchema });
