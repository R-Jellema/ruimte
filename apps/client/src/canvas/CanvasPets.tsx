import { useTranslation } from 'react-i18next';
import { ErrorBoundary, LazyBoundary, lazyNamed } from '@adecore/ui';
import { useSettings } from '@/state/settings';

const PetLayer = lazyNamed(() => import('@/canvas/pets/PetLayer'), 'PetLayer');
const PetRoam = lazyNamed(() => import('@/canvas/pets/PetRoam'), 'PetRoam');

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
        // Turning either one off and on again tries once more after a failure.
        <ErrorBoundary label={t('pets.failed')} resetKeys={[pets, visitor]} compact>
            <LazyBoundary>
                <PetLayer z={z} />
            </LazyBoundary>
        </ErrorBoundary>
    );
}

/* Pets along the bottom of the screen, which a person picks in Settings, Views: over the canvas, in its cell's overlay, under the dock. */
export function CanvasRoamingPets() {
    const { t } = useTranslation('canvas');
    const roaming = useSettings((s) => s.pets && s.petsPlace === 'screen');
    if (!roaming) {
        return null;
    }
    return (
        <ErrorBoundary label={t('pets.failed')} resetKeys={[roaming]} compact>
            <LazyBoundary>
                <PetRoam />
            </LazyBoundary>
        </ErrorBoundary>
    );
}
