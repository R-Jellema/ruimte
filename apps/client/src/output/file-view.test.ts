import { describe, expect, test } from 'bun:test';
import { BYTES_READ_MAX_BYTES, type ArtifactVersion } from '@ruimte/contracts';
import { fileViewOf, firstShownFile, languageOfName } from '@/output/file-view';

function file(name: string, mime: string, size = 10) {
    return { name, mime, size };
}

describe('how a file of a version is drawn', () => {
    test('by what the machine found the file to be', () => {
        expect(fileViewOf(file('rapport.html', 'text/html'))).toBe('page');
        expect(fileViewOf(file('notes.md', 'text/markdown'))).toBe('markdown');
        expect(fileViewOf(file('run.log', 'text/plain'))).toBe('code');
        expect(fileViewOf(file('rows.json', 'application/json'))).toBe('code');
        expect(fileViewOf(file('chart.png', 'image/png'))).toBe('image');
        expect(fileViewOf(file('logo.svg', 'image/svg+xml'))).toBe('image');
        expect(fileViewOf(file('demo.mp4', 'video/mp4'))).toBe('video');
        expect(fileViewOf(file('memo.mp3', 'audio/mpeg'))).toBe('audio');
        expect(fileViewOf(file('report.pdf', 'application/pdf'))).toBe('pdf');
        expect(fileViewOf(file('scene.glb', 'model/gltf-binary'))).toBe('model');
    });

    test('by its name where text could be either', () => {
        expect(fileViewOf(file('page.htm', 'text/plain'))).toBe('page');
        expect(fileViewOf(file('README.markdown', 'text/plain'))).toBe('markdown');
    });

    test('an archive, other binary and text past the read bound have nothing to show', () => {
        expect(fileViewOf(file('app.zip', 'application/zip'))).toBe('none');
        expect(fileViewOf(file('blob.bin', 'application/octet-stream'))).toBe('none');
        expect(fileViewOf(file('huge.log', 'text/plain', BYTES_READ_MAX_BYTES + 1))).toBe('none');
    });

    test('a version opens on the first file there is something to show of', () => {
        const version = { files: [file('app.zip', 'application/zip'), file('notes.md', 'text/markdown')] } as ArtifactVersion;
        expect(firstShownFile(version)).toBe(1);
        expect(firstShownFile({ files: [file('app.zip', 'application/zip')] } as ArtifactVersion)).toBe(0);
    });

    test('text is highlighted by its extension', () => {
        expect(languageOfName('build/out.ts')).toBe('ts');
        expect(languageOfName('Makefile')).toBeUndefined();
    });
});
