import { describe, expect, test } from 'bun:test';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { LANGUAGE_COMMANDS, languageCommandsOf } from './command-table';

describe('toggle rendered documentation command', () => {
    test('sits in the Code menu with the editor key', () => {
        expect(LANGUAGE_COMMANDS['toggle-rendered-docs']).toMatchObject({
            menu: 'code',
            key: 'toggleRenderedDocs',
            shortcut: CANVAS_SHORTCUTS.toggleRenderedDocs
        });
        expect(languageCommandsOf('code')).toContain('toggle-rendered-docs');
    });
});
