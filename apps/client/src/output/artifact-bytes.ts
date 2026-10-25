import { useEffect, useState } from 'react';
import type { ArtifactFile } from '@ruimte/contracts';
import { saveBlob } from '@/download';
import { machineTransport } from '@/transport';
import { readResource } from '@/transport/byte-transfer';
import { readPiece } from '@/transport/piece';

export interface ArtifactFileRef {
    artifactId: string;
    versionId: string;
    /* The file's place in the version's manifest. */
    file: number;
}

/* A file of a version, whole: its size is known and bounded, so the read is allowed up to exactly that. */
export function readArtifactFile(endpointId: string, ref: ArtifactFileRef, file: ArtifactFile): Promise<Blob> {
    const transport = machineTransport(endpointId);
    return readResource((piece) => readPiece(transport, piece), { kind: 'artifact', ...ref }, { maxBytes: Math.max(file.size, 1) });
}

export async function downloadArtifactFile(endpointId: string, ref: ArtifactFileRef, file: ArtifactFile): Promise<void> {
    const blob = await readArtifactFile(endpointId, ref, file);
    await saveBlob(blob, file.name.slice(file.name.lastIndexOf('/') + 1), file.mime);
}

export type TextState = { status: 'loading' } | { status: 'ready'; text: string } | { status: 'failed' };

/* The text of a file of a version. A version never changes, so what was read once stays right. */
export function useArtifactText(endpointId: string, ref: ArtifactFileRef | null, file: ArtifactFile | null): TextState {
    const key = ref === null ? null : `${endpointId}\n${ref.artifactId}\n${ref.versionId}\n${ref.file}`;
    const [held, setHeld] = useState<{ key: string; state: TextState } | null>(null);
    const artifactId = ref?.artifactId;
    const versionId = ref?.versionId;
    const index = ref?.file;
    useEffect(() => {
        if (key === null || file === null || artifactId === undefined || versionId === undefined || index === undefined) {
            return;
        }
        let live = true;
        readArtifactFile(endpointId, { artifactId, versionId, file: index }, file)
            .then((blob) => blob.text())
            .then(
                (text) => live && setHeld({ key, state: { status: 'ready', text } }),
                () => live && setHeld({ key, state: { status: 'failed' } })
            );
        return () => {
            live = false;
        };
    }, [endpointId, key, artifactId, versionId, index, file]);
    return held !== null && held.key === key ? held.state : LOADING;
}

const LOADING: TextState = { status: 'loading' };
