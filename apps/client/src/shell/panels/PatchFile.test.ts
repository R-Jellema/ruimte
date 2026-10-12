/// <reference types="vite/client" />
import { describe, expect, mock, test } from 'bun:test';
import type { FsReadText } from '@ruimte/contracts';
import { isPatchName } from './file-kind.ts';

// The views behind the renderers draw with the DOM and the editor engine, which a unit test has neither of. Each is a named stand-in, so the table can be read by which one it picks.
const stand = (name: string) => ({ [name]: Object.assign(() => null, { displayName: name }) });
mock.module('./AudioFile.tsx', () => stand('AudioFile'));
mock.module('./CodeFile.tsx', () => stand('CodeFile'));
mock.module('./HtmlFile.tsx', () => stand('HtmlFile'));
mock.module('./ImageFile.tsx', () => stand('ImageFile'));
mock.module('./MarkdownFile.tsx', () => stand('MarkdownFile'));
mock.module('./UnsupportedFile.tsx', () => stand('UnsupportedFile'));
mock.module('./PdfPreview.tsx', () => stand('PdfPreview'));
mock.module('./VideoFile.tsx', () => stand('VideoFile'));
mock.module('./patch-file-lazy.tsx', () => stand('PatchFileSlot'));

const { renderFile } = await import('./renderers.tsx');

const READ = { kind: 'text', text: '', size: 0, mtime: 0, encoding: 'utf-8', language: 'diff' } as unknown as FsReadText;

function drawnBy(name: string): string {
    const element = renderFile({ path: `/p/${name}`, name, read: READ });
    return (element.type as { displayName: string }).displayName;
}

describe('which view draws a text file', () => {
    test('a .patch or .diff file mounts the patch mode', () => {
        expect(drawnBy('fix.patch')).toBe('PatchFileSlot');
        expect(drawnBy('FIX.DIFF')).toBe('PatchFileSlot');
    });

    test('other files keep the view they had', () => {
        expect(drawnBy('notes.md')).toBe('MarkdownFile');
        expect(drawnBy('index.html')).toBe('HtmlFile');
        expect(drawnBy('main.ts')).toBe('CodeFile');
        expect(drawnBy('patch')).toBe('CodeFile');
    });

    test('only the extension counts', () => {
        expect(isPatchName('patch')).toBe(false);
        expect(isPatchName('a.patch.bak')).toBe(false);
    });
});
