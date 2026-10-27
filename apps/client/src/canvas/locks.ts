import i18next from 'i18next';
import type { Locks } from '@/state/canvas';

/* The four locks in the order the dock and the settings dialog list them. */
export const LOCK_KEYS: readonly (keyof Locks)[] = ['pan', 'zoom', 'move', 'resize'];

/* Asked for at draw time: this module loads before i18next has words, so a label taken at import would keep the first language. */
export function lockLabel(key: keyof Locks): string {
    return i18next.t(`canvas:locks.${key}.label`);
}

export function lockHint(key: keyof Locks): string {
    return i18next.t(`canvas:locks.${key}.hint`);
}
