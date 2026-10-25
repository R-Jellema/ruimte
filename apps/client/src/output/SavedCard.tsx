import { useTranslation } from 'react-i18next';
import type { ArtifactSummary, ArtifactVersion } from '@ruimte/contracts';
import { KindTile } from '@/output/look';
import { openArtifact } from '@/output/open';

export interface Saved {
    artifact: Pick<ArtifactSummary, 'artifactId' | 'title' | 'kind'>;
    version: ArtifactVersion;
    latest: boolean;
}

/*
 * The versions a chat saved between the same two rows of its thread, as one block of tight rows. The
 * timeline puts no room between two blocks, so the room under this one is its own.
 */
export function SavedCard({ saved }: { saved: readonly Saved[] }) {
    return (
        <div className="flex flex-col pb-(--chat-block-gap)">
            {saved.map((entry) => (
                <SavedRow key={entry.version.versionId} {...entry} />
            ))}
        </div>
    );
}

function SavedRow({ artifact, version, latest }: Saved) {
    const { t } = useTranslation('output');
    const what = version.number === 1 ? t('card.saved') : t('card.savedVersion', { number: version.number });
    return (
        <button
            type="button"
            aria-label={t('card.row', { title: artifact.title, what })}
            className="-mx-1 flex h-8 w-[calc(100%+8px)] min-w-0 items-center gap-2 rounded-md px-1 text-left text-sm text-text-muted hover:bg-surface-hover"
            onClick={() => openArtifact(artifact.artifactId, artifact.title, latest ? null : version.versionId)}
        >
            <KindTile kind={artifact.kind} size="sm" />
            <span className="min-w-0 shrink truncate font-medium text-text">{artifact.title}</span>
            <span className="shrink-0">{what}</span>
        </button>
    );
}
