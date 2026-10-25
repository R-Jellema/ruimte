import { useTranslation } from 'react-i18next';
import { Button, SectionLabel } from '@adecore/ui';
import { formatBytes } from '@adecore/ui/format';
import { useArtifactList } from '@/output/artifacts';
import { KindTile } from '@/output/look';
import { openArtifact, showOutputPanel } from '@/output/open';
import { useMachineAnswers } from '@/transport/features';

/*
 * What a chat saved to Output, above its thread: a chip per artifact that opens it, and the way to
 * the panel. Not a chat item, so the thread and every client that reads it stay as they were. Draws
 * nothing while the chat made nothing, or while the machine keeps no Output.
 */
export function MadeInChat({ endpointId, chatId }: { endpointId: string; chatId: string }) {
    const { t } = useTranslation('output');
    const answers = useMachineAnswers(endpointId, 'artifact.list');
    const list = useArtifactList(endpointId, { chatId }, answers);
    if (list === null || list.artifacts.length === 0) {
        return null;
    }
    const artifacts = [...list.artifacts].sort((left, right) => right.latest.createdAt - left.latest.createdAt);
    return (
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5" role="region" aria-label={t('chat.made')}>
            <SectionLabel className="shrink-0">{t('chat.made')}</SectionLabel>
            <div className="flex min-w-0 grow items-center gap-1.5 overflow-x-auto">
                {artifacts.map((artifact) => (
                    <button
                        key={artifact.artifactId}
                        type="button"
                        className="flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border px-1.5 text-xs hover:bg-surface-hover"
                        onClick={() => openArtifact(artifact.artifactId, artifact.title)}
                    >
                        <KindTile kind={artifact.kind} size="sm" />
                        <span className="max-w-40 truncate font-medium text-text">{artifact.title}</span>
                        <span className="text-text-faint tabular-nums">{formatBytes(artifact.totalBytes)}</span>
                    </button>
                ))}
            </div>
            <Button size="xs" className="shrink-0" onClick={showOutputPanel}>
                {t('chat.open')}
            </Button>
        </div>
    );
}
