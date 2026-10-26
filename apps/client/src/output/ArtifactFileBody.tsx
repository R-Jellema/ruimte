import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleAlert } from 'lucide-react';
import { VisualPageFrame } from '@adecore/agents-react/chat/ui';
import type { ArtifactFile } from '@ruimte/contracts';
import { EmptyState } from '@adecore/ui';
import { readArtifactFile, useArtifactText, type ArtifactFileRef } from '@/output/artifact-bytes';
import { artifactBinaryRead, artifactSource, fileViewOf, languageOfName } from '@/output/file-view';
import { AudioFile } from '@/shell/panels/AudioFile';
import { CodeText } from '@/shell/panels/CodeFile';
import { FileActionsContext } from '@/shell/panels/file-actions';
import { FileMarkdown } from '@/shell/panels/FileMarkdown';
import { ImageFile } from '@/shell/panels/ImageFile';
import { ModelPreview } from '@/shell/panels/ModelPreview';
import { PdfPreview } from '@/shell/panels/PdfPreview';
import { VideoFile } from '@/shell/panels/VideoFile';

export interface ArtifactFileProps {
    endpointId: string;
    reference: ArtifactFileRef;
    file: ArtifactFile;
    /* What the frame of a page is named for a screen reader. */
    title: string;
    /* A version never changes, so its time pins the bytes the way a file's mtime does. */
    createdAt: number;
}

/*
 * One file of a version across the view, drawn by what the file is with the renderers of the files
 * panel. No file menu: it is no file on disk, so nothing of it can be revealed, renamed or saved over.
 * Null for a file there is nothing to show of.
 */
export function ArtifactFileBody(props: ArtifactFileProps) {
    const { endpointId, reference, file, createdAt } = props;
    const view = fileViewOf(file);
    const source = artifactSource(endpointId, reference);
    const read = artifactBinaryRead(file, createdAt);
    const body = (): ReactNode => {
        switch (view) {
            case 'page':
                return <ArtifactPage {...props} />;
            case 'markdown':
            case 'code':
                return <ArtifactText {...props} markdown={view === 'markdown'} />;
            case 'image':
                return <ImageFile source={source} name={file.name} read={read} />;
            case 'video':
                return <VideoFile source={source} name={file.name} read={read} />;
            case 'audio':
                return <AudioFile source={source} name={file.name} read={read} />;
            case 'pdf':
                return <PdfPreview source={source} name={file.name} read={read} />;
            case 'model':
                return <ModelPreview source={source} name={file.name} read={read} />;
            case 'none':
                return null;
        }
    };
    return <FileActionsContext.Provider value={null}>{body()}</FileActionsContext.Provider>;
}

/*
 * An agent's page, in the same sandboxed frame a chat draws a visual in and never on the app's own
 * origin, whatever kind the artifact says it is: the preview the files panel gives a project's HTML
 * runs no script, and a page an agent made for a person is meant to.
 */
/* `auto` grows the frame with its page the way a visual in a chat does; without it the page fills its box. */
export function ArtifactPage({ endpointId, reference, file, title, auto = false }: ArtifactFileProps & { auto?: boolean }) {
    const page = (): Promise<string> => readArtifactFile(endpointId, reference, file).then((blob) => blob.text());
    const key = `${reference.versionId}:${reference.file}`;
    if (auto) {
        return <VisualPageFrame key={key} page={page} title={title} />;
    }
    return (
        <div className="relative min-h-0 grow">
            <VisualPageFrame key={key} page={page} title={title} fill />
        </div>
    );
}

function ArtifactText({ endpointId, reference, file, markdown }: ArtifactFileProps & { markdown: boolean }) {
    const { t } = useTranslation('output');
    const text = useArtifactText(endpointId, reference, file);
    if (text.status !== 'ready') {
        return (
            <div className="grid min-h-0 grow place-items-center">
                {text.status === 'loading' ? (
                    <EmptyState busy>{t('view.loading')}</EmptyState>
                ) : (
                    <EmptyState icon={CircleAlert}>{t('view.readFailed')}</EmptyState>
                )}
            </div>
        );
    }
    if (!markdown) {
        return (
            <div className="flex min-h-0 min-w-0 grow flex-col">
                <CodeText text={text.text} language={languageOfName(file.name)} />
            </div>
        );
    }
    return (
        <div className="min-h-0 grow overflow-y-auto px-6 py-6 select-text">
            <div className="mx-auto max-w-[768px]">
                <FileMarkdown text={text.text} />
            </div>
        </div>
    );
}
