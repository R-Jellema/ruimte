import { join } from 'node:path';
import type { WriteBoundary } from './write.ts';

/* The boundary of one open project, with the machine's worktrees folder at `<root>/home/worktrees`. */
export function projectBoundary(root: string, project: string, worktrees: string[] = []): WriteBoundary {
    return { folders: [project], worktreesOf: async () => worktrees, worktreesRoot: join(root, 'home', 'worktrees') };
}

/* The code a failed call carries, which is what the wire hands the client. */
export async function codeOf(work: Promise<unknown>): Promise<string | undefined> {
    try {
        await work;
        return undefined;
    } catch (e) {
        return (e as { code?: string }).code;
    }
}
