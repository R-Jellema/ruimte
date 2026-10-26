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
    test('a report, an image and a page an agent or a routine published draw inline', () => {
        expect(savedPreviewOf('report', version('agent', [{ name: 'summary.md', mime: 'text/markdown' }]))).toBe('report');
        expect(savedPreviewOf('report', version('routine', [{ name: 'summary.txt', mime: 'text/plain' }]))).toBe('report');
        expect(
            savedPreviewOf(
                'image',
                version('agent', [
                    { name: 'notes.txt', mime: 'text/plain' },
                    { name: 'chart.png', mime: 'image/png' }
                ])
            )
        ).toBe('image');
        expect(savedPreviewOf('page', version('agent', [{ name: 'index.html', mime: 'text/html' }]))).toBe('page');
    });

    test('what a person saved from the thread is already in it', () => {
        expect(savedPreviewOf('report', version('person', [{ name: 'summary.md', mime: 'text/markdown' }]))).toBeNull();
        expect(savedPreviewOf('image', version('person', [{ name: 'shot.png', mime: 'image/png' }]))).toBeNull();
    });

    test('a build, an export, a long report or a kind that does not match its file stays a row', () => {
        expect(savedPreviewOf('build', version('agent', [{ name: 'app.zip', mime: 'application/zip' }]))).toBeNull();
        expect(savedPreviewOf('export', version('agent', [{ name: 'rows.csv', mime: 'text/csv' }]))).toBeNull();
        expect(savedPreviewOf('report', version('agent', [{ name: 'big.md', mime: 'text/markdown', size: PREVIEW_MAX_BYTES + 1 }]))).toBeNull();
        expect(savedPreviewOf('report', version('agent', [{ name: 'report.pdf', mime: 'application/pdf' }]))).toBeNull();
    });
});
