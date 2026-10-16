/* The shared picker order; clients supply the colors and the daemon validates these names. */
export const NODE_ACCENT_NAMES = [
    'red',
    'orange',
    'amber',
    'yellow',
    'lime',
    'green',
    'emerald',
    'teal',
    'cyan',
    'sky',
    'blue',
    'indigo',
    'violet',
    'purple',
    'fuchsia',
    'pink',
    'rose'
] as const;

export type NodeAccent = (typeof NODE_ACCENT_NAMES)[number];
