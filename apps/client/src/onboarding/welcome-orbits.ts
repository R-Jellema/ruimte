import type { EclipseOrbit } from '@/ui/Eclipse';

export const WELCOME_ORBITS: readonly EclipseOrbit[] = [
    { size: 300, alpha: 0.1 },
    { size: 460, alpha: 0.07, spin: 140, moon: { tone: 'cool', left: 88, top: 24 } },
    { size: 680, alpha: 0.05 }
];
