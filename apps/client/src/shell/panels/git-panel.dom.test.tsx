import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { GitStatus, ProjectCanvasView } from '@ruimte/contracts';
import { focusedCanvas } from '@/state/canvas';
import { useUi } from '@/state/ui';
import { FakeMachine } from '../../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../../testing/fake-workspace';
import { clickOn, mount, openSubmenu, until, type Mounted } from '../../../testing/dom';

const FOLDER = '/work/atlas';
const API = `${FOLDER}/api`;
const WEB = `${FOLDER}/web`;
const WORKTREE = '/work/worktrees/atlas/lexer';
const TEAM = {
    id: 'g1',
    kind: 'group' as const,
    title: 'Lexer team',
    x: 0,
    y: 0,
    w: 400,
    h: 300,
    worktree: { path: WORKTREE, branch: 'lexer' }
};
const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [TEAM], texts: [], edges: [], layouts: [] };
// A fixed moment, so the log groups its rows the same way on every run.
const COMMITTED_AT = 1_760_000_000;

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function status(branch: string, behind = 0): GitStatus {
    return {
        repo: true,
        root: null,
        branch,
        detached: false,
        upstream: `origin/${branch}`,
        ahead: 0,
        behind,
        base: 'main',
        mergeBase: null,
        files: [{ path: 'README.md', state: 'unstaged', status: 'M', added: 1, deleted: 0, binary: false }],
        truncated: false,
        live: true
    };
}

function buttonWithText(text: string, within: ParentNode = document.body): HTMLElement | null {
    return [...within.querySelectorAll<HTMLElement>('button')].find((candidate) => candidate.textContent?.trim() === text) ?? null;
}

/* The chip at the start of the panel's header, which opens the picker. */
function chip(startsWith: string): HTMLElement | null {
    return (
        [...document.body.querySelectorAll<HTMLElement>('button[aria-haspopup="menu"]')].find((candidate) => candidate.textContent?.startsWith(startsWith)) ??
        null
    );
}

function menuItem(text: string, role = 'menuitem'): HTMLElement | null {
    return [...document.body.querySelectorAll<HTMLElement>(`[role="${role}"]`)].find((candidate) => candidate.textContent?.includes(text)) ?? null;
}

async function refreshPanel(): Promise<void> {
    await clickOn(document.body.querySelector<HTMLElement>('button[aria-label="More git actions"]'));
    await until(() => menuItem('Refresh') !== null);
    await clickOn(menuItem('Refresh'));
}

/* The row under the header that says the panel is inside a worktree. */
function worktreeRow(): HTMLElement | null {
    return buttonWithText('Merge')?.parentElement ?? null;
}

beforeEach(async () => {
    localStorage.clear();
    machine = new FakeMachine();
    machine.answer('git.repos', () => ({
        repos: [
            { path: API, label: 'api', kind: 'nested' as const },
            { path: WEB, label: 'web', kind: 'nested' as const }
        ],
        truncated: false
    }));
    machine.answer('git.status', ({ cwd }) => status(cwd === WORKTREE ? 'lexer' : 'main'));
    machine.answer('git.worktree-list', () => ({ worktrees: [{ path: WORKTREE, branch: 'lexer' }] }));
    machine.answer('git.log', ({ cwd }) => ({
        commits: [
            {
                hash: `${cwd}-1`,
                shortHash: 'abc1234',
                subject: cwd === API ? 'feat: api work' : cwd === WEB ? 'feat: web work' : 'feat: lexer work',
                author: 'Bas',
                at: COMMITTED_AT,
                refs: []
            }
        ],
        cursor: null
    }));
    workspace = await openFakeWorkspace(machine, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    page = mount();
    await page.renderApp();
    await act(async () => useUi.getState().setPanel({ open: true, kind: 'git' }));
    await until(() => chip('2 repos') !== null);
});

afterEach(async () => {
    await act(async () => useUi.getState().setPanel({ open: false, kind: 'git' }));
    await page.unmount();
    workspace.close();
});

describe('the git panel over a folder of two repositories', () => {
    test('rebasing a repository waits for the person to confirm and cancel leaves it alone', async () => {
        machine.answer('git.refs', () => ({
            refs: [
                { name: 'main', kind: 'local' as const, current: true, isDefault: true, at: 0 },
                { name: 'release', kind: 'local' as const, current: false, isDefault: false, at: 0 }
            ],
            current: 'main',
            stashes: []
        }));
        for (const approve of [false, true]) {
            await clickOn(chip('2 repos'));
            await openSubmenu('Switch branch');
            await openSubmenu('api');
            await openSubmenu('Branch');
            await clickOn(menuItem('Rebase onto…'));
            await until(() => buttonWithText('release') !== null);
            expect(machine.requests('git.action')).toEqual([]);
            await clickOn(buttonWithText('release'));
            await until(() => document.body.textContent?.includes('Rebase onto release?') === true || machine.requests('git.action').length > 0);
            expect(machine.requests('git.action')).toEqual([]);
            expect(document.body.textContent).toContain('Rebase onto release?');
            await clickOn(buttonWithText(approve ? 'Rebase' : 'Cancel'));
            await until(() => !document.body.textContent?.includes('Rebase onto release?'));
            if (!approve) {
                expect(machine.requests('git.action')).toEqual([]);
            }
        }
        await until(() => machine.requests('git.action').length === 1);
        expect(machine.requests('git.action')).toEqual([{ cwd: API, actionId: expect.any(String), kind: 'rebase', ref: 'release' }]);
    });

    test('the picker lists the worktrees, enters one and goes back to the project', async () => {
        expect(chip('2 repos')!.textContent).toContain('1 worktree');
        await clickOn(chip('2 repos'));
        await until(() => menuItem('lexer') !== null);
        expect(menuItem('api, web')).not.toBeNull();
        expect(menuItem('lexer')!.textContent).toContain('no chat');
        await clickOn(menuItem('lexer'));
        await until(() => chip('lexer') !== null);
        expect(chip('2 repos')).toBeNull();
        expect(worktreeRow()?.textContent).toContain('atlas');
        await clickOn(chip('lexer'));
        await until(() => menuItem('api, web') !== null);
        await clickOn(menuItem('api, web'));
        await until(() => chip('2 repos') !== null);
        expect(worktreeRow()).toBeNull();
    });

    test('a selection in a worktree is followed until the picker leaves it', async () => {
        await act(async () => focusedCanvas().getState().select([TEAM.id]));
        await until(() => chip('lexer') !== null);
        expect(worktreeRow()).not.toBeNull();
        await clickOn(chip('lexer'));
        await until(() => menuItem('api, web') !== null);
        await clickOn(menuItem('api, web'));
        await until(() => chip('2 repos') !== null);
    });

    test('a repository behind its upstream says so, and Sync brings it level', async () => {
        machine.answer('git.status', ({ cwd }) => status('main', cwd === API ? 3 : 0));
        await refreshPanel();
        await until(() => document.body.textContent?.includes('api is 3 commits behind origin') === true);
        const banner = [...document.body.querySelectorAll<HTMLElement>('[role="status"]')].find((candidate) =>
            candidate.textContent?.includes('api is 3 commits behind origin')
        );
        expect(document.body.textContent).not.toContain('web is');
        await clickOn(buttonWithText('Sync', banner));
        await until(() => machine.requests('git.action').length === 1);
        expect(machine.requests('git.action')).toEqual([expect.objectContaining({ cwd: API, kind: 'sync' })]);
    });

    test("the commit button's menu commits and pushes", async () => {
        machine.answer('git.status', ({ cwd }) => {
            const base = status('main');
            return cwd === API ? { ...base, files: [{ ...base.files[0]!, state: 'staged' as const }] } : base;
        });
        await refreshPanel();
        const field = (): HTMLTextAreaElement | null => document.body.querySelector<HTMLTextAreaElement>('textarea[aria-label="Commit message"]');
        await until(() => field() !== null);
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field(), 'fix: the readme');
            field()!.dispatchEvent(new Event('input', { bubbles: true }));
        });
        const more = (): HTMLButtonElement | null => document.body.querySelector<HTMLButtonElement>('button[aria-label="More ways to commit"]');
        await until(() => more()?.disabled === false);
        await clickOn(more());
        await until(() => menuItem('Commit and push') !== null);
        await clickOn(menuItem('Commit and push'));
        await until(() => machine.requests('git.action').length === 1);
        expect(machine.requests('git.action')).toEqual([expect.objectContaining({ cwd: API, kind: 'commit-push' })]);
    });

    test('a repository without changes says so under its row while it is open', async () => {
        machine.answer('git.status', ({ cwd }) => (cwd === WEB ? { ...status('main'), files: [] } : status('main')));
        await refreshPanel();
        const tree = (): ShadowRoot | null => page.host.querySelector('.adecore-file-tree-host')?.shadowRoot ?? null;
        const emptyLine = (): HTMLElement | null => tree()?.querySelector<HTMLElement>('[data-empty-line="true"]') ?? null;
        await until(() => emptyLine() !== null);
        expect(emptyLine()!.querySelector<HTMLElement>('[data-item-section="content"]')?.dataset.emptyLabel).toBe('No changes');
        const repoRow = tree()!.querySelector<HTMLElement>(`[data-type="item"][data-item-path="${emptyLine()!.dataset.itemPath!.replace(/[^/]*$/, '')}"]`);
        expect(repoRow?.textContent).toContain('web');
        await clickOn(repoRow);
        await until(() => emptyLine() === null);
    });

    test('the log narrows to one repository and widens again', async () => {
        await until(() => document.body.textContent?.includes('feat: web work') === true);
        expect(document.body.textContent).toContain('feat: api work');
        await clickOn(buttonWithText('All repos'));
        await until(() => menuItem('api', 'menuitemradio') !== null);
        await clickOn(menuItem('api', 'menuitemradio'));
        await until(() => !document.body.textContent?.includes('feat: web work'));
        expect(document.body.textContent).toContain('feat: api work');
        await clickOn(buttonWithText('api'));
        await until(() => menuItem('All repos', 'menuitemradio') !== null);
        await clickOn(menuItem('All repos', 'menuitemradio'));
        await until(() => document.body.textContent?.includes('feat: web work') === true);
    });
});
