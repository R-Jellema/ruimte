export type StorageTarget = Pick<Window, 'addEventListener' | 'removeEventListener'>;

/*
 * Windows share `localStorage`, so a store that read its key once would write a stale copy over another
 * window's change. `storage` fires in every page but the writer. A key of null is the storage cleared.
 */
export function followOtherWindows(key: string, reread: () => void, target: StorageTarget | null = typeof window === 'undefined' ? null : window): () => void {
    if (target === null) {
        return () => undefined;
    }
    const onStorage = (event: StorageEvent): void => {
        if (event.key === key || event.key === null) {
            reread();
        }
    };
    target.addEventListener('storage', onStorage);
    return () => target.removeEventListener('storage', onStorage);
}
