import { describe, expect, test } from 'bun:test';
import { BUILT_IN_LIVE_TEMPLATES, BUILT_IN_POSTFIX_TEMPLATES } from '@adecore/editor-react';
import { BUILT_IN_LIVE_TEMPLATE_KEYS, BUILT_IN_POSTFIX_TEMPLATE_KEYS } from '@ruimte/contracts';

// The daemon refuses an agent's key against these without loading the editor, so they follow ADE CORE's lists.
describe('the built-in template keys of the daemon', () => {
    test('are the live templates of the editor', () => {
        expect(BUILT_IN_LIVE_TEMPLATE_KEYS).toEqual(BUILT_IN_LIVE_TEMPLATES.map(({ id, key, languages }) => ({ id, key, languages })));
    });

    test('are the postfix templates of the editor', () => {
        expect(BUILT_IN_POSTFIX_TEMPLATE_KEYS).toEqual(BUILT_IN_POSTFIX_TEMPLATES.map(({ id, key, languages }) => ({ id, key, languages })));
    });
});
