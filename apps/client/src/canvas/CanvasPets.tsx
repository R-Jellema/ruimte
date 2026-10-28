import { useTranslation } from 'react-i18next';
import { ErrorBoundary, LazyBoundary, lazyNamed } from '@adecore/ui';
import { useSettings } from '@/state/settings';

const PetLayer = lazyNamed(() => import('@/canvas/pets/PetLayer'), 'PetLayer');

/*
 * Pets, which a person turns on in Settings, Views, or the visitor that may drop by while they are
 * off. The figures load only once one of the two can show, so a canvas without either carries none.
 */
export function CanvasPets({ z }: { z: number }) {
    const { t } = useTranslation('canvas');
    const pets = useSettings((s) => s.pets);
    const visitor = useSettings((s) => s.petsVisitor);
    if (!pets && !visitor) {
        return null;
    }
    return (
        <ErrorBoundary label={t('pets.failed')} compact>
            <LazyBoundary>
                <PetLayer z={z} />
            </LazyBoundary>
        </ErrorBoundary>
    );
}
