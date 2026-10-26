import { join } from 'node:path';
import { RecordDirectory } from '@adecore/agents';
import { RoutinePickedSchema, type RoutinePicked } from '@ruimte/contracts';
import { z } from 'zod';

export { MAX_PROMPT_LENGTH } from '@ruimte/actions';

const PendingPromptSchema = z.object({
    projectId: z.string().min(1),
    nodeId: z.string().min(1),
    prompt: z.string().min(1),
    createdAt: z.number(),
    // Ruimte's own instructions for the first turn, which a chat hears beside the prompt and folds away in its thread.
    brief: z.string().min(1).optional(),
    // What a person picked in the prompt, sent with it as `chat.send` would: a routine's `@`, `$` and `#`.
    picked: RoutinePickedSchema.optional()
});

type PendingPrompt = z.infer<typeof PendingPromptSchema>;

export interface FirstPrompt {
    prompt: string;
    brief?: string;
    picked?: RoutinePicked;
}

/*
 * The first prompt of an agent node, held against the node id until its session or chat exists. Not
 * in `project.json`, which two people share and two windows would deliver twice; on disk, since the
 * daemon may restart before the node starts.
 */
export class PendingPromptStore {
    readonly dir: string;
    private readonly pending: RecordDirectory<PendingPrompt>;

    constructor(home: string) {
        this.dir = join(home, 'prompts');
        this.pending = new RecordDirectory({ dir: this.dir, schema: PendingPromptSchema, idOf: (entry) => entry.nodeId });
    }

    /* Reads what an earlier run of the daemon was still holding. Call before anything can take one. */
    load(): Promise<void> {
        return this.pending.load();
    }

    async put(projectId: string, nodeId: string, prompt: string, brief?: string, picked?: RoutinePicked): Promise<void> {
        await this.pending.write({
            projectId,
            nodeId,
            prompt,
            createdAt: Date.now(),
            ...(brief === undefined ? {} : { brief }),
            ...(picked === undefined ? {} : { picked })
        });
    }

    /*
     * The prompt held for a node, gone the moment it is asked for. The map is emptied before the
     * first await, so two clients mounting the same node cannot both get it, and the file is gone
     * before the caller is answered, so a restart in between does not hand it out a second time.
     */
    async take(nodeId: string): Promise<FirstPrompt | null> {
        const entry = this.pending.get(nodeId);
        if (!entry) {
            return null;
        }
        await this.pending.remove(nodeId);
        return {
            prompt: entry.prompt,
            ...(entry.brief === undefined ? {} : { brief: entry.brief }),
            ...(entry.picked === undefined ? {} : { picked: entry.picked })
        };
    }

    has(nodeId: string): boolean {
        return this.pending.has(nodeId);
    }

    /* Drops what this project was holding for ids it no longer has: the node was deleted before anyone ran it. */
    prune(projectId: string, ids: ReadonlySet<string>): Promise<void> {
        return this.pending.prune((entry) => entry.projectId === projectId && !ids.has(entry.nodeId));
    }
}
