import { isArchiveMime, isAudioMime, isImageMime, isModelMime, isPdfMime, isVideoMime, type FsReadResult, type FsReadText } from '@ruimte/contracts';
import { ArchivePreview } from '@/shell/panels/ArchivePreview';
import { AudioFile } from '@/shell/panels/AudioFile';
import { CodeFile } from '@/shell/panels/CodeFile';
import { isDelimitedName, isHtmlName, isMarkdownName, isPatchName } from '@/shell/panels/file-kind';
import { fileSource } from '@/shell/panels/file-source';
import { HtmlFile } from '@/shell/panels/HtmlFile';
import { ImageFile } from '@/shell/panels/ImageFile';
import { MarkdownFile } from '@/shell/panels/MarkdownFile';
import { ModelPreview } from '@/shell/panels/ModelPreview';
import { UnsupportedFile } from '@/shell/panels/UnsupportedFile';
import { PatchFileSlot } from '@/shell/panels/patch-file-lazy';
import { PdfPreview } from '@/shell/panels/PdfPreview';
import { TableFile } from '@/shell/panels/TableFile';
import { VideoFile } from '@/shell/panels/VideoFile';

interface FileRendererProps {
    /* Absolute on the daemon's machine. */
    path: string;
    name: string;
    read: FsReadResult;
}

interface TextFileRenderer {
    id: string;
    /* Whether this renderer takes the file, decided on its name alone. */
    match(name: string): boolean;
    render(props: { path: string; name: string; read: FsReadText }): React.JSX.Element;
}

/*
 * What draws a text file, tried in order; anything no entry claims falls to the code view, which
 * takes every language shiki knows and plain text for the rest.
 */
const TEXT_RENDERERS: readonly TextFileRenderer[] = [
    {
        id: 'markdown',
        match: (name) => isMarkdownName(name),
        render: (props) => <MarkdownFile path={props.path} read={props.read} />
    },
    {
        id: 'html',
        match: (name) => isHtmlName(name),
        render: (props) => <HtmlFile path={props.path} name={props.name} read={props.read} />
    },
    {
        id: 'patch',
        match: (name) => isPatchName(name),
        render: (props) => <PatchFileSlot path={props.path} read={props.read} />
    },
    {
        id: 'delimited',
        match: (name) => isDelimitedName(name),
        render: (props) => <TableFile path={props.path} name={props.name} read={props.read} />
    }
];

/* The name picks a renderer for a text file; what the read found picks everything else. */
export function renderFile({ path, name, read }: FileRendererProps): React.JSX.Element {
    if (read.kind === 'text') {
        const renderer = TEXT_RENDERERS.find((entry) => entry.match(name));
        return renderer ? renderer.render({ path, name, read }) : <CodeFile path={path} read={read} />;
    }
    if (read.kind === 'binary' && isImageMime(read.mime)) {
        return <ImageFile source={fileSource(path)} name={name} read={read} />;
    }
    if (read.kind === 'binary' && isVideoMime(read.mime)) {
        return <VideoFile source={fileSource(path)} name={name} read={read} />;
    }
    if (read.kind === 'binary' && isAudioMime(read.mime)) {
        return <AudioFile source={fileSource(path)} name={name} read={read} />;
    }
    if (read.kind === 'binary' && isPdfMime(read.mime)) {
        return <PdfPreview source={fileSource(path)} name={name} read={read} />;
    }
    if (read.kind === 'binary' && isModelMime(read.mime)) {
        return <ModelPreview source={fileSource(path)} name={name} read={read} />;
    }
    if (read.kind === 'binary' && isArchiveMime(read.mime)) {
        return <ArchivePreview path={path} name={name} read={read} />;
    }
    return <UnsupportedFile path={path} name={name} read={read} />;
}
