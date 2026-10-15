import { MAX_TITLE_LENGTH } from '../index.ts';
import { describeWrites } from './harness.ts';

const project = { endpointId: 'endpoint-1', projectId: 'ruimte' } as const;
const appearance = { ...project, name: 'Ruimte', icon: null } as const;

describeWrites('projects', {
    'project.switch': {
        actors: ['person', 'voice'],
        input: project,
        refused: { 'an empty machine': { ...project, endpointId: '' }, 'no project': { endpointId: 'endpoint-1' } }
    },
    'project.close': {
        actors: ['person', 'voice'],
        input: project,
        refused: { 'an empty project': { ...project, projectId: '' } },
        confirms: true
    },
    'project.create': {
        actors: ['person'],
        input: { endpointId: 'endpoint-1', folder: '/Users/bas/Development/Projects/ruimte', createFolder: false },
        refused: {
            'an empty folder': { endpointId: 'endpoint-1', folder: '', createFolder: null },
            'no answer to createFolder': { endpointId: 'endpoint-1', folder: '/tmp/new' }
        }
    },
    'chat.move': {
        actors: ['person'],
        input: { endpointId: 'endpoint-1', chatId: 'chat-1', to: { projectId: 'ruimte' }, ownFiles: 'leave' },
        refused: {
            'a folder that is not a full path': {
                endpointId: 'endpoint-1',
                chatId: 'chat-1',
                to: { folder: 'vinyl', name: 'Vinyl', createFolder: true, initGit: false },
                ownFiles: 'leave'
            },
            'files copied': { endpointId: 'endpoint-1', chatId: 'chat-1', to: { projectId: 'ruimte' }, ownFiles: 'copy' },
            'no chat': { endpointId: 'endpoint-1', to: { projectId: 'ruimte' }, ownFiles: 'leave' }
        }
    },
    'project.propose': {
        actors: ['agent'],
        input: { name: 'Vinyl shelf', folder: '/work/vinyl-shelf', reason: 'The notes became a codebase' },
        refused: {
            'a blank name': { name: ' ', reason: 'The notes became a codebase' },
            'no reason': { name: 'Vinyl shelf' },
            'a wait past what a call holds': { name: 'Vinyl shelf', reason: 'The notes became a codebase', wait: 111 }
        }
    },
    'project.delete': {
        actors: ['person'],
        input: { ...project, removeFiles: true },
        refused: { 'no answer to removeFiles': project, 'removeFiles as a word': { ...project, removeFiles: 'yes' } },
        confirms: true
    },
    'project.setAppearance': {
        actors: ['person', 'voice'],
        input: appearance,
        refused: {
            'a name past the title limit': { ...appearance, name: 'x'.repeat(MAX_TITLE_LENGTH + 1) },
            'an empty icon': { ...appearance, icon: '' },
            'no icon at all': { ...project, name: 'Ruimte' }
        },
        restricted: {
            image: { value: { mime: 'image/png', base64: 'iVBORw0KGgo=' }, actors: ['person'] }
        }
    }
});
