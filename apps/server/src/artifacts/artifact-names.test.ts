import { describe, expect, test } from 'bun:test';
import { checkFileName, checkKey, kindOf, mimeOf, relativeSegments } from './artifact-names.ts';

const text = (value: string): Uint8Array => new TextEncoder().encode(value);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe('artifact names', () => {
    test('a key is lowercase with dashes, and routine keys are the machine own', () => {
        expect(checkKey('weekly-report')).toBe('weekly-report');
        expect(() => checkKey('routine:nightly')).toThrow(expect.objectContaining({ code: 'key-reserved' }));
        expect(() => checkKey('-lead')).toThrow(expect.objectContaining({ code: 'bad-key' }));
        expect(() => checkKey('a'.repeat(65))).toThrow(expect.objectContaining({ code: 'bad-key' }));
    });

    test('a file name is a relative label without a way out', () => {
        expect(checkFileName('dist/app.zip')).toBe('dist/app.zip');
        for (const name of ['', '../x', 'a//b', '/abs', 'a\\b', 'a\u0000b', './a']) {
            expect(() => checkFileName(name)).toThrow(expect.objectContaining({ code: 'bad-name' }));
        }
    });

    test('a copy path stays in the project folder and out of its own files', () => {
        expect(relativeSegments('docs/./report.md')).toEqual(['docs', 'report.md']);
        for (const path of ['/etc/passwd', 'C:/x', '../x', 'a/../../b', '.', '.ruimte/project.json', '.git/config']) {
            expect(() => relativeSegments(path)).toThrow(expect.objectContaining({ code: 'bad-path' }));
        }
    });

    test('the bytes decide the type before the name does, and the type decides the kind', () => {
        expect(mimeOf('shot.txt', PNG, PNG.length)).toBe('image/png');
        expect(mimeOf('notes.md', text('# Notes'), 7)).toBe('text/markdown');
        expect(mimeOf('page.html', text('<p>hi</p>'), 9)).toBe('text/html');
        expect(mimeOf('data.bin', new Uint8Array([0, 1, 2, 3]), 4)).toBe('application/octet-stream');
        expect(mimeOf('README', text('plain words'), 11)).toBe('text/plain');
        expect([kindOf('image/png'), kindOf('text/markdown'), kindOf('text/html'), kindOf('video/mp4'), kindOf('text/csv'), kindOf('application/zip')]).toEqual(
            ['image', 'report', 'page', 'recording', 'export', 'build']
        );
    });
});
