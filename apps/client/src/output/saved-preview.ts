import type { ArtifactVersion } from '@ruimte/contracts';
import { drawnKind, isTextMime } from '@/output/artifact-list';

export type SavedPreviewKind = 'report' | 'image' | 'page';

// Past this a report or page is read only when a person opens it, so a long thread never pulls megabytes.
export const PREVIEW_MAX_BYTES = 256 * 1024;

/*
 * How the thread draws a version an agent or a routine published, so its reply need not repeat it, or
 * null when it stays a row. What a person saved from the thread is already in it.
 */
export function savedPreviewOf(kind: string, version: ArtifactVersion): SavedPreviewKind | null {
    if (version.provenance.maker === 'person') {
        return null;
    }
    const first = version.files[0];
    if (first === undefined) {
        return null;
    }
    const drawn = drawnKind(kind);
    if (drawn === 'report' && isTextMime(first.mime) && first.size <= PREVIEW_MAX_BYTES) {
        return 'report';
    }
    if (drawn === 'image' && version.files.some((file) => file.mime.startsWith('image/'))) {
        return 'image';
    }
    if (drawn === 'page' && first.mime === 'text/html' && first.size <= PREVIEW_MAX_BYTES) {
        return 'page';
    }
    return null;
}
