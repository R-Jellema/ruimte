import { afterEach, describe, expect, test } from 'bun:test';
import type { DesktopBridge, Release, ReleaseNotesState } from '@/desktop/bridge';
import { ensureReleaseNotes, useReleaseNotes } from '@/state/release-notes';

function release(version: string, body = '- Something changed.'): Release {
    return {
        version,
        publishedAt: '2026-09-14T07:52:45Z',
        body,
        url: `https://github.com/basmilius/ruimte/releases/tag/v${version}`,
        compareUrl: null
    };
}

const LIST = [release('0.0.8'), release('0.0.7')];

describe('loading', () => {
    const scope = globalThis as unknown as { window?: { ruimteDesktop?: Partial<DesktopBridge> } };

    afterEach(() => {
        delete scope.window;
        useReleaseNotes.setState({ notes: null, loading: false });
    });

    test('reads the cached list once', async () => {
        const asked: boolean[] = [];
        const answer: ReleaseNotesState = { releases: LIST, fetchedAt: null, error: null };
        scope.window = {
            ruimteDesktop: {
                releaseNotes: async (refresh?: boolean) => {
                    asked.push(refresh === true);
                    return answer;
                }
            }
        };
        ensureReleaseNotes();
        ensureReleaseNotes();
        await new Promise((done) => setTimeout(done, 0));
        expect(asked).toEqual([false]);
        expect(useReleaseNotes.getState().notes).toEqual(answer);
    });

    test('does nothing without a shell', () => {
        ensureReleaseNotes();
        expect(useReleaseNotes.getState().notes).toBeNull();
    });
});
