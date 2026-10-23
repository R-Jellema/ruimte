import { type WriteCases } from './case.ts';

export const cases: WriteCases = {
    'file.preview': {
        actors: ['person', 'voice'],
        input: { path: 'apps/server/src/daemon.ts', line: 12, column: 4, endLine: 14 },
        refused: {
            'an empty path': { path: '' },
            'a column without a line': { path: 'README.md', column: 4 },
            'a range that runs back': { path: 'README.md', line: 20, endLine: 10 },
            'line zero': { path: 'README.md', line: 0 }
        }
    },
    'file.reveal': {
        actors: ['person', 'voice'],
        input: { path: 'apps/client/src' },
        refused: { 'an empty path': { path: '' } }
    },
    'file.create': {
        actors: ['person'],
        input: { path: 'docs/notes.md', kind: 'file', text: '# Notes\n' },
        refused: {
            'a kind it does not make': { path: 'docs/link', kind: 'symlink', text: null },
            'no text at all': { path: 'docs/notes.md', kind: 'file' }
        }
    },
    'file.delete': {
        actors: ['person'],
        input: { paths: ['docs/old.md', 'tmp'] },
        refused: { 'nothing to delete': { paths: [] }, 'an empty path': { paths: [''] } }
    },
    'file.rename': {
        actors: ['person'],
        input: { path: 'src/Old.php', to: 'src/Domain/New.php' },
        refused: { 'nowhere to go': { path: 'src/Old.php' }, 'an empty target': { path: 'src/Old.php', to: '' } }
    },
    'file.copyPath': {
        actors: ['person', 'voice'],
        input: { path: 'package.json', relative: true },
        refused: { 'no answer to relative': { path: 'package.json' } }
    },
    'file.copy': {
        actors: ['person', 'voice'],
        input: { paths: ['README.md'] },
        refused: { 'nothing to copy': { paths: [] } }
    }
};
