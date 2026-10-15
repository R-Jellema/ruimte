import { isAbsolutePath, relativeTo } from '@ruimte/contracts';

function inside(folder: string, cwd: string): boolean {
    return !isAbsolutePath(cwd) || cwd === folder || relativeTo(folder, cwd) !== cwd;
}

/*
 * The folder the nodes of a machine work in when linking that machine again to `chosen` would strand them,
 * or null when it does not. The checkout the old link named is the one they keep, since a worktree of it is
 * one of no other; when that machine forgot it, every node has to work inside the chosen folder.
 */
export function strandedBy(chosen: string, linkedFolder: string | null, cwds: readonly string[]): string | null {
    if (linkedFolder !== null) {
        return linkedFolder === chosen ? null : linkedFolder;
    }
    return cwds.find((cwd) => !inside(chosen, cwd)) ?? null;
}
