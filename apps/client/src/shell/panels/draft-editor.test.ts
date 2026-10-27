import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { useSettings } from '@/state/settings';
import { type DraftLink, TextDrafts, useTextDrafts } from '@/state/text-drafts';
import { bindDraftEditor } from './draft-editor';

const PATH = '/work/app/notes.ts';

function setup(text: string) {
    let onDisk = { text, mtime: 1 };
    const written: string[] = [];
    const link: DraftLink = {
        read: async (path) => ({ kind: 'text', path, ...onDisk }) as never,
        write: async (_path, next) => {
            written.push(next);
            onDisk = { text: next, mtime: onDisk.mtime + 1 };
            return { mtime: onDisk.mtime } as never;
        },
        projectOpen: async () => undefined
    };
    const drafts = new TextDrafts(() => link);
    drafts.open('local', PATH, onDisk);
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text, theme: 'light' });
    const unbind = bindDraftEditor(editor, drafts, 'local', PATH);
    const changeOnDisk = (next: string): void => {
        onDisk = { text: next, mtime: onDisk.mtime + 1 };
    };

    return { drafts, editor, unbind, written, changeOnDisk };
}

beforeEach(() => {
    useTextDrafts.setState({ rows: {} });
});

afterEach(() => {
    useTextDrafts.setState({ rows: {} });
    useSettings.setState({ codeTrailingWhitespace: 'off' });
});

describe('the whitespace of a file editor on save', () => {
    test('is cleaned as the setting says, keeping the lines with a caret, right before the write', async () => {
        useSettings.setState({ codeTrailingWhitespace: 'modified' });
        const { drafts, editor, unbind, written } = setup('const a = 1;\n');

        drafts.edit('local', PATH, 'const a = 2;\n');
        await drafts.save('local', PATH);

        expect(editor.cleanups).toEqual([{ trailingWhitespace: 'modified', keepCaretLines: true }]);
        expect(written).toEqual(['const a = 2;\n']);
        unbind();
    });

    test('still marks the text as saved while the cleanup is off, so changed lines count from there', async () => {
        const { drafts, editor, unbind } = setup('const a = 1;\n');

        drafts.edit('local', PATH, 'const a = 2;\n');
        await drafts.save('local', PATH);

        expect(editor.cleanups).toEqual([{ trailingWhitespace: 'off', keepCaretLines: true }]);
        expect(editor.savedMarks).toBe(1);
        unbind();
    });

    test('counts changed lines from a reload of the file', async () => {
        const { drafts, editor, unbind, changeOnDisk } = setup('const a = 1;\n');

        changeOnDisk('const a = 3;\n');
        await drafts.reload('local', PATH);

        expect(editor.getText()).toBe('const a = 3;\n');
        expect(editor.savedMarks).toBe(1);
        expect(editor.cleanups).toEqual([]);
        unbind();
    });
});
