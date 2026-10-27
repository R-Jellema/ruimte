import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(onChange: () => void) {
    const query = window.matchMedia(QUERY);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
}

function getSnapshot() {
    return window.matchMedia(QUERY).matches;
}

// The server's first frame moves, so hydration matches it before the browser's preference applies.
function getServerSnapshot() {
    return false;
}

export function useReducedAnimations() {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
