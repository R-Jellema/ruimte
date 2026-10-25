import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { RecordDirectory } from '@adecore/agents';
import { RoutineMadeBySchema, RoutineRunSchema, type RoutineMadeBy, type RoutineRun } from '@ruimte/contracts';
import { z } from 'zod';

/* What this machine ran of the routines, one record per run, under `$RUIMTE_HOME/routine-runs`. A removed routine keeps them. */
export class RoutineRunStore {
    private readonly records: RecordDirectory<RoutineRun>;

    constructor(home: string) {
        this.records = new RecordDirectory({ dir: join(home, 'routine-runs'), schema: RoutineRunSchema, idOf: (run) => run.runId });
    }

    load(): Promise<void> {
        return this.records.load();
    }

    get(runId: string): RoutineRun | undefined {
        return this.records.get(runId);
    }

    /* Newest first. */
    of(projectId: string, routineId: string): RoutineRun[] {
        return this.records
            .all()
            .filter((run) => run.projectId === projectId && run.routineId === routineId)
            .sort((a, b) => b.at - a.at || b.due - a.due);
    }

    all(): RoutineRun[] {
        return this.records.all();
    }

    /* The run a chat belongs to now: the newest one that ran in it. */
    ofChat(chatId: string): RoutineRun | undefined {
        return this.records
            .all()
            .filter((run) => run.chatId === chatId)
            .sort((a, b) => b.at - a.at)[0];
    }

    async put(run: RoutineRun): Promise<void> {
        await this.records.write(run);
    }
}

const AuthorSchema = RoutineMadeBySchema.extend({
    key: z.string().min(1),
    projectId: z.string().min(1),
    routineId: z.string().min(1),
    // The definition the agent left, so a later change by anyone else is not laid at its door.
    digest: z.string().min(1)
});
type Author = z.infer<typeof AuthorSchema>;

function authorKey(projectId: string, routineId: string): string {
    return createHash('sha256')
        .update(JSON.stringify([projectId, routineId]))
        .digest('hex')
        .slice(0, 32);
}

/* The agent chat that last made or changed each routine, under `$RUIMTE_HOME`, since an agent could write anything into a project file. */
export class RoutineAuthorStore {
    private readonly records: RecordDirectory<Author>;

    constructor(home: string) {
        this.records = new RecordDirectory({ dir: join(home, 'routine-authors'), schema: AuthorSchema, idOf: (author) => author.key });
    }

    load(): Promise<void> {
        return this.records.load();
    }

    /* Who made the routine as it stands, or undefined once anyone else changed it since. */
    of(projectId: string, routineId: string, digest: string): RoutineMadeBy | undefined {
        const author = this.records.get(authorKey(projectId, routineId));
        if (author === undefined || author.digest !== digest) {
            return undefined;
        }
        return { chatId: author.chatId, title: author.title, at: author.at };
    }

    async put(projectId: string, routineId: string, digest: string, madeBy: RoutineMadeBy): Promise<void> {
        await this.records.write({ key: authorKey(projectId, routineId), projectId, routineId, digest, ...madeBy });
    }
}
