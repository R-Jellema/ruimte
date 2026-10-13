import { describeWrites } from './harness.ts';

describeWrites('pages', {
    'browser.navigate': {
        actors: ['person', 'voice', 'agent'],
        input: { nodeId: 'browser-1', url: 'https://ruimte.app' },
        refused: { 'an empty address': { nodeId: 'browser-1', url: '' }, 'no node': { url: 'https://ruimte.app' } }
    },
    'browser.back': {
        actors: ['person', 'voice', 'agent'],
        input: { nodeId: 'browser-1' },
        refused: { 'an empty node': { nodeId: '' } }
    },
    'browser.forward': {
        actors: ['person', 'voice', 'agent'],
        input: { nodeId: 'browser-1' },
        refused: { 'an empty node': { nodeId: '' } }
    },
    'browser.reload': {
        actors: ['person', 'voice', 'agent'],
        input: { nodeId: 'browser-1', hard: true },
        refused: { 'no answer to hard': { nodeId: 'browser-1' } }
    },
    'browser.stop': {
        actors: ['person', 'voice', 'agent'],
        input: { nodeId: 'browser-1' },
        refused: { 'no node': {} }
    }
});
