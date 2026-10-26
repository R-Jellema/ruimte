import { createContext, useContext } from 'react';
import { openArtifact } from '@/output/open';

/* `versionId` null follows the newest version, as the Output view does; `shown` is the version the person clicked. */
export type OpenArtifact = (artifactId: string, title: string, versionId: string | null, shown: string) => void;

/* A surface that shows Output itself, such as a routine's run, opens a version there rather than leaving for the Output view. */
export const ArtifactOpenerContext = createContext<OpenArtifact | null>(null);

function openInOutput(artifactId: string, title: string, versionId: string | null): void {
    openArtifact(artifactId, title, versionId);
}

export function useOpenArtifact(): OpenArtifact {
    return useContext(ArtifactOpenerContext) ?? openInOutput;
}
