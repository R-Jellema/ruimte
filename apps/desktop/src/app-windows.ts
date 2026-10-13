import {
    WINDOW_DORMANT_PARAM,
    WINDOW_PROJECT_PARAM,
    WINDOW_START_PARAM,
    WINDOW_STATE_PARAM,
    WINDOW_VIEW_PARAM,
    type AgentActivity
} from '@ruimte/desktop-bridge';

/*
 * The address a window loads for its key. Without a key it opens on the start screen, except the
 * one window of a start without a session (`first`): that one loads the bare address, where the
 * page opens the project it remembers, as the app did before it had more than one window. A
 * `dormant` window leaves its project closed until it has the focus.
 */
export function windowUrl(base: string, key: string | null, first: boolean, view: string | null = null, state: string | null = null, dormant = false): string {
    if (key === null && first && state === null) {
        return base;
    }
    const url = new URL(base);
    if (key === null) {
        if (!first) {
            url.searchParams.set(WINDOW_START_PARAM, '1');
        }
    } else {
        url.searchParams.set(WINDOW_PROJECT_PARAM, key);
        if (view !== null) {
            url.searchParams.set(WINDOW_VIEW_PARAM, view);
        }
        if (dormant) {
            url.searchParams.set(WINDOW_DORMANT_PARAM, '1');
        }
    }
    if (state !== null) {
        url.searchParams.set(WINDOW_STATE_PARAM, state);
    }
    return url.toString();
}

/* What a page may keep for its window across a quit. The shell never reads it, so only its size is checked. */
export function isWindowState(value: unknown): value is string | null {
    return value === null || (typeof value === 'string' && value.length <= 8192);
}

/* Where a page draws its tab strip, in its own coordinates; null for anything else, and for a page without one. */
export function tabStripOf(value: unknown): { x: number; y: number; width: number; height: number } | null {
    if (typeof value !== 'object' || value === null) {
        return null;
    }
    const { x, y, width, height } = value as Record<string, unknown>;
    const numbers = [x, y, width, height];
    if (!numbers.every((one) => typeof one === 'number' && Number.isFinite(one)) || (width as number) <= 0 || (height as number) <= 0) {
        return null;
    }
    return { x: x as number, y: y as number, width: width as number, height: height as number };
}

/* A point on the screen a new window's corner goes to, from a page that dragged something out. */
export function windowPointOf(value: unknown): { x: number; y: number } | undefined {
    if (typeof value !== 'object' || value === null) {
        return undefined;
    }
    const { x, y } = value as { x?: unknown; y?: unknown };
    return typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
}

/* A key a page may ask for: the page's own, never read here. */
export function isWindowKey(value: unknown): value is string {
    return typeof value === 'string' && value !== '' && value.length <= 512;
}

/* A view a page asks a window to show, as opaque to the shell as a key. */
export function isWindowView(value: unknown): value is string {
    return typeof value === 'string' && value !== '' && value.length <= 256;
}

function count(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/* Every window counts the agents of its own project, so the app's share is their sum. */
export function totalActivity(activities: Iterable<AgentActivity>): AgentActivity {
    let working = 0;
    let attention = 0;
    for (const activity of activities) {
        working += count(activity.working);
        attention += count(activity.attention);
    }
    return { working, attention };
}
