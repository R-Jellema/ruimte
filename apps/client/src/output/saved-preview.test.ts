import { describe, expect, test } from 'bun:test';
import type { ArtifactVersion } from '@ruimte/contracts';
import { PREVIEW_MAX_BYTES, savedPreviewOf } from '@/output/saved-preview';

function version(maker: 'agent' | 'person' | 'routine', files: { name: string; mime: string; size?: number }[]): ArtifactVersion {
    return {
        versionId: 'v1',
        number: 1,
        createdAt: 1,
        files: files.map((file) => ({ size: 10, sha256: 'aa', ...file })),
        bytes: 10,
        provenance: { maker, machineId: 'mac', chatId: 'chat' },
        copiedTo: []
    };
}

describe('what the thread draws of a saved version', () => {
    test('a page, a document, text, an image and a PDF an agent or a routine published draw inline', () => {
        expect(savedPreviewOf(version('agent', [{ name: 'summary.md', mime: 'text/markdown' }]))).toEqual({ view: 'markdown', file: 0 });
        expect(savedPreviewOf(version('routine', [{ name: 'summary.txt', mime: 'text/plain' }]))).toEqual({ view: 'code', file: 0 });
        expect(savedPreviewOf(version('routine', [{ name: 'rapport.html', mime: 'text/html' }]))).toEqual({ view: 'page', file: 0 });
        expect(savedPreviewOf(version('agent', [{ name: 'report.pdf', mime: 'application/pdf' }]))).toEqual({ view: 'pdf', file: 0 });
        expect(
            savedPreviewOf(
                version('agent', [
                    { name: 'app.zip', mime: 'application/zip' },
                    { name: 'chart.png', mime: 'image/png' }
                ])
            )
        ).toEqual({ view: 'image', file: 1 });
    });

    test('what a person saved from the thread is already in it', () => {
        expect(savedPreviewOf(version('person', [{ name: 'summary.md', mime: 'text/markdown' }]))).toBeNull();
        expect(savedPreviewOf(version('person', [{ name: 'shot.png', mime: 'image/png' }]))).toBeNull();
    });

    test('a file with nothing to show, a long file or a model stays a row', () => {
        expect(savedPreviewOf(version('agent', [{ name: 'app.zip', mime: 'application/zip' }]))).toBeNull();
        expect(savedPreviewOf(version('agent', [{ name: 'scene.glb', mime: 'model/gltf-binary' }]))).toBeNull();
        expect(savedPreviewOf(version('agent', [{ name: 'big.md', mime: 'text/markdown', size: PREVIEW_MAX_BYTES + 1 }]))).toBeNull();
        expect(savedPreviewOf(version('agent', [{ name: 'big.pdf', mime: 'application/pdf', size: PREVIEW_MAX_BYTES + 1 }]))).toBeNull();
    });
});
