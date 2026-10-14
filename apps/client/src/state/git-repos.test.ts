import { describe, expect, test } from 'bun:test';
import type { GitRepo } from '@ruimte/contracts';
import type { GitFile, GitStatus } from '@ruimte/contracts';
import { TransportError, type TransportStatus } from '@/transport/transport';
import { headMoved, readProjectRepos, visibleRepos, withoutNestedRepos } from './git-repos.ts';

function file(path: string, state: GitFile['state']): GitFile {
    return {
        path,
        state,
        status: state === 'untracked' ? '?' : 'M',
        added: 1,
        deleted: 0,
        binary: false
    };
}

function status(files: GitFile[]): GitStatus {
    return {
        repo: true,
        root: '/work/app',
        branch: 'main',
        detached: false,
        upstream: null,
        ahead: 0,
        behind: 0,
        base: null,
        mergeBase: null,
        files,
        truncated: false,
        live: true
    };
}

const repos: GitRepo[] = [
    { path: '/work/app', label: 'app', kind: 'root' },
    { path: '/work/app/backend', label: 'backend', kind: 'submodule' },
    { path: '/work/app/frontend', label: 'frontend', kind: 'submodule' }
];

describe('which repositories the panel draws', () => {
    test('the ones a person hid are out, by the label they were hidden under', () => {
        expect(visibleRepos(repos, ['backend']).map((repo) => repo.label)).toEqual(['app', 'frontend']);
    });

    test('a label nobody has anymore hides nothing', () => {
        expect(visibleRepos(repos, ['tools'])).toEqual(repos);
    });

    test('hiding every one of them leaves the panel with none, not with all', () => {
        expect(visibleRepos(repos, ['app', 'backend', 'frontend'])).toEqual([]);
    });
});

describe('a repository inside another', () => {
    const others = ['/work/app', '/work/app/inner'];

    test('the untracked folder it shows up as in the one above it is dropped', () => {
        const before = status([file('inner/', 'untracked'), file('a.ts', 'unstaged')]);
        expect(withoutNestedRepos(before, '/work/app', others)?.files.map((entry) => entry.path)).toEqual(['a.ts']);
    });

    test('a tracked change at that path stays, which is what a submodule gitlink is', () => {
        const before = status([file('inner', 'unstaged')]);
        expect(withoutNestedRepos(before, '/work/app', others)).toBe(before);
    });

    test('a checkout with nothing inside it keeps the very status it was given', () => {
        const before = status([file('a.ts', 'untracked')]);
        expect(withoutNestedRepos(before, '/work/app/inner', others)).toBe(before);
        expect(withoutNestedRepos(null, '/work/app', others)).toBeNull();
    });
});

describe('when the log has to be read again', () => {
    test('the first status of a checkout is no move, since the log is read beside it', () => {
        expect(headMoved(null, status([]))).toBe(false);
    });

    test('a file that changed moves no commit', () => {
        expect(headMoved(status([]), status([file('a.ts', 'unstaged')]))).toBe(false);
    });

    test('a commit, a pull and a switch all show up', () => {
        const before = status([]);
        expect(headMoved(before, { ...before, ahead: 1 })).toBe(true);
        expect(headMoved(before, { ...before, behind: 2 })).toBe(true);
        expect(headMoved(before, { ...before, branch: 'feature/x' })).toBe(true);
        expect(headMoved(before, { ...before, detached: true })).toBe(true);
        expect(headMoved(before, { ...before, upstream: 'origin/main' })).toBe(true);
        expect(headMoved(before, { ...before, mergeBase: 'abc' })).toBe(true);
    });
});

describe('reading the repositories of a folder', () => {
    function link(request: () => Promise<{ repos: GitRepo[]; truncated: boolean }>) {
        const listeners = new Set<(status: TransportStatus) => void>();
        return {
            request: request as never,
            subscribeStatus: (listener: (status: TransportStatus) => void) => {
                listeners.add(listener);
                return () => listeners.delete(listener);
            },
            listeners,
            open: () => [...listeners].forEach((listener) => listener('open'))
        };
    }

    const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

    test('a real answer, an empty one included, is the list', async () => {
        const answers: unknown[] = [];
        readProjectRepos(
            link(async () => ({ repos: [], truncated: false })),
            '/work',
            false,
            { answered: (a) => answers.push(a), again: () => {} }
        );
        await settle();
        expect(answers).toEqual([{ repos: [], truncated: false }]);
    });

    test('a failure that is an answer of the machine means no repository', async () => {
        const answers: unknown[] = [];
        const failing = link(async () => {
            throw new TransportError('git-failed', 'No');
        });
        readProjectRepos(failing, '/work', false, { answered: (a) => answers.push(a), again: () => {} });
        await settle();
        expect(answers).toEqual([{ repos: [], truncated: false }]);
    });

    test('a dropped link or a timeout keeps the list and asks again once the link is open', async () => {
        for (const code of ['disconnected', 'not-connected', 'timeout']) {
            const answers: unknown[] = [];
            let again = 0;
            const dropped = link(async () => {
                throw new TransportError(code, 'Gone');
            });
            readProjectRepos(dropped, '/work', false, { answered: (a) => answers.push(a), again: () => again++ });
            await settle();
            expect(answers).toEqual([]);
            expect(again).toBe(0);
            dropped.open();
            dropped.open();
            expect(again).toBe(1);
            expect(dropped.listeners.size).toBe(0);
        }
    });

    test('cancelling stops the wait for the link', async () => {
        let again = 0;
        const dropped = link(async () => {
            throw new TransportError('disconnected', 'Gone');
        });
        const cancel = readProjectRepos(dropped, '/work', false, { answered: () => {}, again: () => again++ });
        await settle();
        cancel();
        dropped.open();
        expect(again).toBe(0);
    });
});
