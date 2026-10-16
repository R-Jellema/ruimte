import { useTranslation } from 'react-i18next';
import type { FsReadBinary } from '@ruimte/contracts';
import { sourceKey, type FileSource } from '@/shell/panels/file-source';
import { ErrorBoundary, lazyNamed, LazyBoundary } from '@adecore/ui';

// pdf.js is most of a megabyte, so it waits for the first PDF or for the prefetcher.
const PdfFile = lazyNamed(() => import('@/shell/panels/PdfFile'), 'PdfFile');

export function PdfPreview({ source, name, read }: { source: FileSource; name: string; read: FsReadBinary }) {
    const { t } = useTranslation('panels');
    return (
        <ErrorBoundary label={t('file.pdf.crashed')} resetKeys={[sourceKey(source, read)]} className="min-h-0 grow">
            <LazyBoundary>
                <PdfFile source={source} name={name} read={read} />
            </LazyBoundary>
        </ErrorBoundary>
    );
}
