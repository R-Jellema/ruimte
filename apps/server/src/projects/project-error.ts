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
    | 'project-ids-taken';

export class ProjectError extends CodedError<ProjectErrorCode> {}
