import i18next from 'i18next';
import type { CSSProperties } from 'react';
import { NODE_ACCENT_NAMES, type NodeAccent, type NotePaper } from '@ruimte/contracts';

export type AccentId = NodeAccent;

/*
 * Tailwind's 600 ramp without the grays, in sRGB hex rather than the oklch Tailwind writes them in:
 * an accent reaches xterm as a literal color and its parser knows no oklch. The names and their
 * order (Tailwind's own, which is the hue wheel) come from contracts, because the daemon refuses a
 * `--color` against the same set; only the paint is the client's.
 */
const ACCENT_COLORS: Record<AccentId, string> = {
    red: '#e7000b',
    orange: '#f54900',
    amber: '#e17100',
    yellow: '#d08700',
    lime: '#5ea500',
    green: '#00a63e',
    emerald: '#009966',
    teal: '#009689',
    cyan: '#0092b8',
    sky: '#0084d1',
    blue: '#155dfc',
    indigo: '#4f39f6',
    violet: '#7f22fe',
    purple: '#9810fa',
    fuchsia: '#c800de',
    pink: '#e60076',
    rose: '#ec003f'
};

export const NODE_ACCENTS: readonly { id: AccentId; color: string }[] = NODE_ACCENT_NAMES.map((id) => ({ id, color: ACCENT_COLORS[id] }));

/* Asked for when a menu draws one, never held: this list is built before i18next has any words, so
   a name taken at import would stay in whichever language loaded first. */
export function accentLabel(id: AccentId): string {
    return i18next.t(`canvas:accents.${id}`);
}

/* The five a settings row shows in the open, blue (the one Ruimte carries) first and the others
   spread around the wheel. The rest sits behind the overflow beside them, which wears the accent
   itself once one is picked. */
export const FEATURED_ACCENTS: readonly AccentId[] = ['blue', 'orange', 'lime', 'indigo', 'pink'];

export function accentColor(id: string | null | undefined): string | undefined {
    return NODE_ACCENTS.find((entry) => entry.id === id)?.color;
}

/* How a colored node wears its accent (`NodeFrame.tsx`), and the cards drawn beside it with it. */
export function accentShades(accent: string): { frameBorder: string; header: string; headerBorder: string; hover: string; line: string } {
    return {
        // A line it draws to what it owns: its color, dimmed toward the neutral line so it stays quieter than the node.
        line: `color-mix(in srgb, ${accent} 45%, var(--edge-line))`,
        frameBorder: `color-mix(in srgb, ${accent} 45%, var(--border))`,
        header: `color-mix(in srgb, ${accent} 20%, var(--surface-raised))`,
        headerBorder: `color-mix(in srgb, ${accent} 35%, var(--border))`,
        // A button's hover in a colored header is a deeper shade of that color, not the gray of a plain surface.
        hover: `color-mix(in srgb, ${accent} 34%, var(--surface-raised))`
    };
}

/*
 * A colored header, and what stands in it with it: an icon button reads `--surface-hover` itself and a
 * utility `--color-surface-hover`, a separator `--color-border`, so all three are set where the color is.
 */
export function accentHeaderStyle(accent: string): CSSProperties {
    const shades = accentShades(accent);
    return {
        backgroundColor: shades.header,
        borderColor: shades.headerBorder,
        '--surface-hover': shades.hover,
        '--color-surface-hover': shades.hover,
        '--color-border': shades.headerBorder
    } as CSSProperties;
}

/* Spelled out whole so Tailwind sees every class; each is a token in styles.css with a light and a dark value. */
const PAPER_CLASSES: Record<NotePaper, string> = {
    red: 'bg-paper-red',
    orange: 'bg-paper-orange',
    amber: 'bg-paper-amber',
    yellow: 'bg-paper-yellow',
    lime: 'bg-paper-lime',
    green: 'bg-paper-green',
    emerald: 'bg-paper-emerald',
    teal: 'bg-paper-teal',
    cyan: 'bg-paper-cyan',
    sky: 'bg-paper-sky',
    blue: 'bg-paper-blue',
    indigo: 'bg-paper-indigo',
    violet: 'bg-paper-violet',
    purple: 'bg-paper-purple',
    fuchsia: 'bg-paper-fuchsia',
    pink: 'bg-paper-pink',
    rose: 'bg-paper-rose',
    neutral: 'bg-paper-neutral'
};

/* A note without a color keeps the yellow sheet every note had before it could take one. */
export function notePaperClass(paper: NotePaper | null): string {
    return PAPER_CLASSES[paper ?? 'yellow'];
}
