import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { VisualPageFrame } from '@adecore/agents-react/chat/ui';
import { ErrorBoundary, Icon } from '@adecore/ui';
import type { ArtifactFile } from '@ruimte/contracts';
import { readArtifactFile, useArtifactText, type ArtifactFileRef } from '@/output/artifact-bytes';
import { openArtifact } from '@/output/open';
import type { Saved } from '@/output/SavedCard';
import type { SavedPreviewKind } from '@/output/saved-preview';
import { FileMarkdown } from '@/shell/panels/FileMarkdown';
import { useMachineUrl } from '@/transport/machine-url';

const MAX_IMAGES = 4;
const PAGE_MAX_HEIGHT = 480;

/* A folded report fades out at the bottom instead of cutting a line in half, the way a long prompt folds. */
const FOLD = '[mask-image:linear-gradient(to_bottom,black_70%,transparent)]';

export function SavedPreview({ endpointId, entry, preview }: { endpointId: string; entry: Saved; preview: SavedPreviewKind }) {
    const { t } = useTranslation('output');
    return (
        <ErrorBoundary label={t('view.failed')} resetKeys={[entry.version.versionId]} compact className="mt-1 mb-2">
            {preview === 'report' && <ReportPreview endpointId={endpointId} entry={entry} />}
            {preview === 'image' && <ImagesPreview endpointId={endpointId} entry={entry} />}
            {preview === 'page' && <PagePreview endpointId={endpointId} entry={entry} />}
        </ErrorBoundary>
    );
}

function refOf(entry: Saved, file: number): ArtifactFileRef {
    return { artifactId: entry.artifact.artifactId, versionId: entry.version.versionId, file };
}

function openEntry(entry: Saved): void {
    openArtifact(entry.artifact.artifactId, entry.artifact.title, entry.latest ? null : entry.version.versionId);
}

function ReportPreview({ endpointId, entry }: { endpointId: string; entry: Saved }) {
    const { t } = useTranslation('output');
    const file = entry.version.files[0]!;
    const text = useArtifactText(endpointId, refOf(entry, 0), file);
    const [open, setOpen] = useState(false);
    const [long, setLong] = useState(false);

    const measure = (node: HTMLDivElement | null) => {
        if (node === null) {
            return;
        }
        const check = () => {
            if (node.scrollHeight > node.clientHeight + 1) {
                setLong(true);
            }
        };
        check();
        if (typeof ResizeObserver === 'undefined') {
            return;
        }
        const observer = new ResizeObserver(check);
        observer.observe(node);
        if (node.firstElementChild !== null) {
            observer.observe(node.firstElementChild);
        }
        return () => observer.disconnect();
    };

    // A report that cannot be read stays the row above, which opens it in Output.
    if (text.status !== 'ready') {
        return null;
    }
    return (
        <div className="flex flex-col items-start">
            <div
                ref={measure}
                aria-label={entry.artifact.title}
                role="group"
                className={`w-full rounded-lg border border-border bg-clip-padding px-4 py-3 text-sm select-text ${open ? '' : 'max-h-80 overflow-hidden'} ${long && !open ? FOLD : ''}`}
            >
                {file.mime === 'text/markdown' ? (
                    <FileMarkdown text={text.text} />
                ) : (
                    <pre className="font-mono text-sm whitespace-pre-wrap text-text">{text.text}</pre>
                )}
            </div>
            {long && (
                <button
                    type="button"
                    aria-expanded={open}
                    className="mt-1 flex items-center gap-1 text-xs text-text-muted hover:text-text"
                    onClick={() => setOpen(!open)}
                >
                    <Icon icon={ChevronDown} size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
                    {open ? t('card.showLess') : t('card.showAll')}
                </button>
            )}
        </div>
    );
}

function ImagesPreview({ endpointId, entry }: { endpointId: string; entry: Saved }) {
    const images = entry.version.files
        .map((file, index) => ({ file, index }))
        .filter(({ file }) => file.mime.startsWith('image/'))
        .slice(0, MAX_IMAGES);
    return (
        <div className="flex flex-wrap gap-2">
            {images.map(({ file, index }) => (
                <SavedImage key={index} endpointId={endpointId} entry={entry} reference={refOf(entry, index)} file={file} />
            ))}
        </div>
    );
}

function SavedImage({ endpointId, entry, reference, file }: { endpointId: string; entry: Saved; reference: ArtifactFileRef; file: ArtifactFile }) {
    const bytes = useMachineUrl({ kind: 'artifact', ...reference }, endpointId);
    if (bytes.url === null) {
        return null;
    }
    return (
        <button type="button" className="overflow-hidden rounded-lg" onClick={() => openEntry(entry)}>
            <img src={bytes.url} alt={file.name} className="block max-h-80 max-w-full object-contain" />
        </button>
    );
}

/* A page in the same sandboxed frame a chat draws a visual in, never on the app's own origin. */
function PagePreview({ endpointId, entry }: { endpointId: string; entry: Saved }) {
    const file = entry.version.files[0]!;
    const page = (): Promise<string> => readArtifactFile(endpointId, refOf(entry, 0), file).then((blob) => blob.text());
    return <VisualPageFrame key={entry.version.versionId} page={page} title={entry.artifact.title} maxHeight={PAGE_MAX_HEIGHT} />;
}
