import { MAX_TITLE_LENGTH } from '../index.ts';
import { type WriteCases } from './case.ts';

export const cases: WriteCases = {
    'layout.save': {
        actors: ['person', 'voice'],
        input: { viewId: 'board', name: 'Review' },
        refused: {
            'a blank name': { viewId: 'board', name: ' ' },
            'a name past the title limit': { viewId: 'board', name: 'x'.repeat(MAX_TITLE_LENGTH + 1) }
        },
        confirms: true
    },
    'layout.apply': {
        actors: ['person', 'voice'],
        input: { viewId: 'board', name: 'Review' },
        refused: { 'a blank name': { viewId: 'board', name: '' }, 'no canvas': { name: 'Review' } }
    },
    'layout.delete': {
        actors: ['person', 'voice'],
        input: { viewId: 'board', name: 'Review' },
        refused: { 'a blank name': { viewId: 'board', name: ' ' } },
        confirms: true
    },
    'split.create': {
        actors: ['person', 'voice'],
        input: { direction: 'right', viewId: null },
        refused: { 'a direction it does not split in': { direction: 'left', viewId: null }, 'an empty view': { direction: 'down', viewId: '' } }
    },
    'split.close': {
        actors: ['person', 'voice'],
        input: { viewId: 'board' },
        refused: { 'an empty view': { viewId: '' }, 'no view at all': {} }
    },
    'split.focus': {
        actors: ['person', 'voice'],
        input: { direction: 'up' },
        refused: { 'a direction it has not': { direction: 'back' } }
    },
    'split.placeView': {
        actors: ['person', 'voice'],
        input: { viewId: 'board', paths: null, cellViewId: null, zone: 'center', tabGap: 1 },
        refused: {
            'a zone it has not': { viewId: 'board', paths: null, cellViewId: null, zone: 'corner' },
            'an empty list of files': { viewId: null, paths: [], cellViewId: null, zone: 'left' },
            'a negative gap': { viewId: 'board', paths: null, cellViewId: null, zone: 'center', tabGap: -1 },
            'a gap between tabs': { viewId: 'board', paths: null, cellViewId: null, zone: 'center', tabGap: 1.5 }
        }
    }
};
