import { CodedError } from '@adecore/agents';
import { trashPath } from './trash.ts';
import { assertOpenGround, realEntryPath, realRoots, rootOf, type WriteBoundary } from './write.ts';

class DeleteError extends CodedError<'not-found' | 'project-root'> {}

/*
 * Moves a file or folder of an open project to the trash, inside the same boundary a save keeps.
 * A symbolic link is trashed as the link and never followed, so a link out of the project cannot
 * take its target along. Nothing is trashed until `run`, so a caller can first do what has to come before.
 */
export async function planDelete(path: string, boundary: WriteBoundary, trash: (path: string) => Promise<void> = trashPath): Promise<{ run(): Promise<void> }> {
    const real = await realEntryPath(path);
    if (real === null) {
        throw new DeleteError('not-found', 'That path is not there');
    }
    const roots = await realRoots(boundary);
    const root = rootOf(roots, real, path);
    if (roots.includes(real)) {
        throw new DeleteError('project-root', 'A project folder is removed by closing the project, not from here');
    }
    assertOpenGround(root, real, path, 'deleted');
    return { run: () => trash(real) };
}
