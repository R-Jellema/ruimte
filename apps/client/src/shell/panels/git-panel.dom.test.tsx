import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { GitStatus, ProjectCanvasView } from '@ruimte/contracts';
import { focusedCanvas } from '@/state/canvas';
import { useGit } from '@/state/git';
import { useUi } from '@/state/ui';
import { FakeMachine } from '../../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../../testing/fake-workspace';
import { clickOn, mount, openSubmenu, until, type Mounted } from '../../../testing/dom';

const FOLDER = '/work/atlas';
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

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function status(branch: string): GitStatus {
    return {
        repo: true,
        root: null,
        branch,
        detached: false,
        upstream: `origin/${branch}`,
        ahead: 0,
        behind: 0,
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

function worktreesHeader(): HTMLElement | null {
    return (
        [...document.body.querySelectorAll<HTMLElement>('button[aria-expanded]')].find((candidate) => candidate.textContent?.startsWith('Worktrees')) ?? null
    );
}

/* A row of the worktrees section; the group on the canvas has a pill with the branch too. */
function rowButton(text: string): HTMLElement | null {
    const section = worktreesHeader()?.closest('section');
    return section ? buttonWithText(text, section) : null;
}

function rowOf(text: string): HTMLElement | null {
    return rowButton(text)?.closest('li') ?? null;
}

function followBar(): HTMLElement | null {
    return [...document.body.querySelectorAll<HTMLElement>('span')].find((candidate) => candidate.textContent === 'Follows the selection: Lexer team') ?? null;
}

beforeEach(async () => {
    localStorage.clear();
    useGit.setState({ worktreesOpen: false });
    machine = new FakeMachine();
    machine.answer('git.repos', () => ({
        repos: [
            { path: `${FOLDER}/api`, label: 'api', kind: 'nested' as const },
            { path: `${FOLDER}/web`, label: 'web', kind: 'nested' as const }
        ],
        truncated: false
    }));
    machine.answer('git.status', ({ cwd }) => status(cwd === WORKTREE ? 'lexer' : 'main'));
    machine.answer('git.worktree-list', () => ({ worktrees: [{ path: WORKTREE, branch: 'lexer' }] }));
    workspace = await openFakeWorkspace(machine, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    page = mount();
    await page.renderApp();
    await act(async () => useUi.getState().setPanel({ open: true, kind: 'git' }));
    await until(() => buttonWithText('2 repositories') !== null);
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
            await clickOn(buttonWithText('2 repositories'));
            await openSubmenu('api');
            await openSubmenu('Branch');
            const rebase = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent === 'Rebase onto…');
            await clickOn(rebase ?? null);
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
        expect(machine.requests('git.action')).toEqual([{ cwd: `${FOLDER}/api`, actionId: expect.any(String), kind: 'rebase', ref: 'release' }]);
    });

    test('the worktrees start folded and open on a click', async () => {
        await until(() => worktreesHeader() !== null);
        expect(worktreesHeader()!.getAttribute('aria-expanded')).toBe('false');
        expect(rowButton('Project folder')).toBeNull();
        await clickOn(worktreesHeader());
        await until(() => rowButton('Project folder') !== null);
        expect(worktreesHeader()!.getAttribute('aria-expanded')).toBe('true');
        expect(rowOf('Project folder')!.getAttribute('aria-current')).toBe('true');
        expect(rowOf('lexer')).not.toBeNull();
    });

    test('the project folder row leaves a worktree picked by hand', async () => {
        await until(() => worktreesHeader() !== null);
        await clickOn(worktreesHeader());
        await until(() => rowButton('lexer') !== null);
        await clickOn(rowButton('lexer'));
        await until(() => rowOf('lexer')?.getAttribute('aria-current') === 'true');
        expect(buttonWithText('2 repositories')).toBeNull();
        expect(followBar()).toBeNull();
        await clickOn(rowButton('Project folder'));
        await until(() => rowOf('Project folder')?.getAttribute('aria-current') === 'true');
        expect(buttonWithText('2 repositories')).not.toBeNull();
    });

    test('a selection in a worktree is followed, and the bar goes back to the project folder', async () => {
        await act(async () => focusedCanvas().getState().select([TEAM.id]));
        await until(() => followBar() !== null);
        expect(buttonWithText('2 repositories')).toBeNull();
        await clickOn(buttonWithText('Back to project folder'));
        await until(() => followBar() === null);
        await until(() => buttonWithText('2 repositories') !== null);
    });
});
