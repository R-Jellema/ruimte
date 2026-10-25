import { useTranslation } from 'react-i18next';
import type { ArtifactSummary, ArtifactVersion } from '@ruimte/contracts';
import { Button } from '@adecore/ui';
import { formatBytes } from '@adecore/ui/format';
import { KindTile } from '@/output/look';
import { openArtifact } from '@/output/open';

export interface Saved {
    artifact: Pick<ArtifactSummary, 'artifactId' | 'title' | 'kind'>;
    version: ArtifactVersion;
    latest: boolean;
}

/* One version a chat saved to Output, as one line of its thread. */
export function SavedCard({ artifact, version, latest }: Saved) {
    const { t } = useTranslation('output');
    return (
        <div className="flex h-8 min-w-0 items-center gap-2 text-sm text-text-muted" role="group" aria-label={artifact.title}>
            <KindTile kind={artifact.kind} size="sm" />
            <span className="min-w-0 shrink truncate font-medium text-text">{artifact.title}</span>
            <span className="shrink-0">{version.number === 1 ? t('card.saved') : t('card.savedVersion', { number: version.number })}</span>
            <span className="shrink-0 text-text-faint tabular-nums">{formatBytes(version.bytes)}</span>
            <span className="grow" />
            <Button
                size="xs"
                variant="ghost"
                className="shrink-0"
                onClick={() => openArtifact(artifact.artifactId, artifact.title, latest ? null : version.versionId)}
            >
                {t('card.open')}
            </Button>
        </div>
    );
}
