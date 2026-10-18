import i18next from 'i18next';
import { create } from 'zustand';
import { desktop, type ReleaseNotesState } from '@/desktop/bridge';

interface ReleaseNotesStore {
    /* Null until the shell answered once. */
    notes: ReleaseNotesState | null;
    loading: boolean;
}

export const useReleaseNotes = create<ReleaseNotesStore>(() => ({
    notes: null,
    loading: false
}));

export function canShowReleaseNotes(): boolean {
    return typeof desktop()?.releaseNotes === 'function';
}

let pending: Promise<void> | null = null;
let running = 0;

export function loadReleaseNotes(refresh: boolean): Promise<void> {
    const bridge = desktop();
    if (!bridge?.releaseNotes) {
        return Promise.resolve();
    }
    const ask = bridge.releaseNotes.bind(bridge);
    // A refresh behind a plain read would answer with the list the read already had.
    const run = async (): Promise<void> => {
        // Before the first await, so a second `ensureReleaseNotes` in the same tick sees it.
        running += 1;
        useReleaseNotes.setState({ loading: true });
        await pending;
        try {
            useReleaseNotes.setState({ notes: await ask(refresh) });
        } catch (e) {
            const previous = useReleaseNotes.getState().notes;
            useReleaseNotes.setState({
                notes: {
                    releases: previous?.releases ?? [],
                    fetchedAt: previous?.fetchedAt ?? null,
                    error: e instanceof Error ? e.message : i18next.t('state:update.noAnswer')
                }
            });
        } finally {
            // A read that ends under a refresh still running must not flash "not available yet".
            running -= 1;
            useReleaseNotes.setState({ loading: running > 0 });
        }
    };
    const current = run();
    pending = current;
    return current;
}

/* The list from the shell's copy, once a session, for the release date About shows. */
export function ensureReleaseNotes(): void {
    const state = useReleaseNotes.getState();
    if (state.notes !== null || state.loading) {
        return;
    }
    void loadReleaseNotes(false);
}
