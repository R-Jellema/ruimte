import { CodedError } from '@adecore/agents';

type ProjectErrorCode =
    | 'project-not-found'
    | 'project-missing'
    | 'project-invalid'
    // The file is ahead of this daemon. Nothing is written, nothing is moved: only a newer Ruimte may touch it.
    | 'project-too-new'
    | 'rev-conflict'
    | 'folder-not-found'
    | 'folder-create-failed'
    | 'bad-icon'
    // Another copy of the canvas is open here, and a session is keyed on its node id.
    | 'project-ids-taken'
    // A node that runs on another machine would reach the shared file as a plain node of this one.
    | 'remote-node-shared'
    // A node that runs on another machine would start here as soon as it became a view of its own.
    | 'remote-node-view'
    // The canvas a machine keeps for another one is not a view to commit.
    | 'hidden-view-shared';

export class ProjectError extends CodedError<ProjectErrorCode> {}
