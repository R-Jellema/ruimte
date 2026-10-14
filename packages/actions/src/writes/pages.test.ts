import { describeWrites } from './harness.ts';

describeWrites('pages', {
    'browser.navigate': {
        actors: ['person', 'voice', 'agent'],
        input: { nodeId: 'browser-1', url: 'https://ruimte.app' },
        refused: { 'an empty address': { nodeId: 'browser-1', url: '' }, 'no node': { url: 'https://ruimte.app' } },
        restricted: { viewId: { value: 'main', actors: ['agent'] } }
    },
    'browser.back': {
        actors: ['person', 'voice', 'agent'],
        input: { nodeId: 'browser-1' },
        refused: { 'an empty node': { nodeId: '' } },
        restricted: { viewId: { value: 'main', actors: ['agent'] } }
    },
    'browser.forward': {
        actors: ['person', 'voice', 'agent'],
        input: { nodeId: 'browser-1' },
        refused: { 'an empty node': { nodeId: '' } },
        restricted: { viewId: { value: 'main', actors: ['agent'] } }
    },
    'browser.reload': {
        actors: ['person', 'voice', 'agent'],
        input: { nodeId: 'browser-1', hard: true },
        refused: { 'no answer to hard': { nodeId: 'browser-1' } },
        restricted: { viewId: { value: 'main', actors: ['agent'] } }
    },
    'browser.stop': {
        actors: ['person', 'voice', 'agent'],
        input: { nodeId: 'browser-1' },
        refused: { 'no node': {} },
        restricted: { viewId: { value: 'main', actors: ['agent'] } }
    }
});
