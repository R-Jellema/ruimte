import type { UsageClientKind } from '@ruimte/contracts';
import { isDesktop } from '@/desktop/bridge';
import { IS_STATION } from '@/station';

/* What this app tells a machine it is, for the machine's anonymous usage counts; null for a page in a plain browser tab. */
export function usageClientKind(): UsageClientKind | null {
    if (IS_STATION) {
        return 'station';
    }
    return isDesktop() ? 'desktop' : null;
}
