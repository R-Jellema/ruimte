import { describe, expect, test } from 'bun:test';
import { chunksWithInlineScripts } from './inline-scripts.ts';

describe('scripts loaded by URL', () => {
    test('a chunk that loads a script from a data: URL is named', () => {
        const bundle = {
            'assets/controller.js': { type: 'chunk' as const, code: 'addModule(new URL(`data:text/javascript;base64,Lyo=`, import.meta.url).href)' },
            'assets/index.js': { type: 'chunk' as const, code: 'addModule(new URL(`/assets/speech-tap.js`, import.meta.url).href)' },
            'assets/logo.svg': { type: 'asset' as const }
        };
        expect(chunksWithInlineScripts(bundle)).toEqual(['assets/controller.js']);
    });
});
