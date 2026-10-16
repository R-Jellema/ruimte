import { useTranslation } from 'react-i18next';
import type { FsReadBinary } from '@ruimte/contracts';
import { ErrorBoundary, lazyNamed, LazyBoundary } from '@adecore/ui';

// The 3D engine and its loaders are most of a megabyte, so they wait for the first model or for the prefetcher.
const ModelFile = lazyNamed(() => import('@/shell/panels/ModelFile'), 'ModelFile');

export function ModelPreview({ path, name, read }: { path: string; name: string; read: FsReadBinary }) {
    const { t } = useTranslation('panels');
    return (
        <ErrorBoundary label={t('file.model.crashed')} resetKeys={[path, read.mtime, read.size]} className="min-h-0 grow">
            <LazyBoundary>
                <ModelFile path={path} name={name} read={read} />
            </LazyBoundary>
        </ErrorBoundary>
    );
}
