import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { GitFile, GitStatus, ProjectCanvasView } from '@ruimte/contracts';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { mount, until, type Mounted } from '../../testing/dom';

const FOLDER = '/work/atlas';
const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [], texts: [], edges: [], layouts: [] };

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function file(path: string, state: GitFile['state']): GitFile {
    return { path, state, status: state === 'untracked' ? '?' : 'M', added: 1, deleted: 0, binary: false };
}

function status(files: GitFile[]): GitStatus {
    return {
        repo: true,
        root: FOLDER,
        branch: 'main',
        detached: false,
        upstream: 'origin/main',
        ahead: 0,
        behind: 0,
        base: 'main',
        mergeBase: null,
        files,
        truncated: false,
        live: true
    };
}

function gitButton(): HTMLButtonElement | null {
    return document.querySelector<HTMLButtonElement>('header button[aria-label^="Git"]');
}

function dotOn(button: HTMLButtonElement | null): boolean {
    return button?.querySelector('span[aria-hidden="true"].rounded-full') != null;
}

beforeEach(async () => {
    localStorage.clear();
    machine = new FakeMachine();
    machine.answer('git.watch', ({ cwd }) => ({ status: status(cwd === FOLDER ? [file('README.md', 'unstaged'), file('notes.md', 'untracked')] : []) }));
    workspace = await openFakeWorkspace(machine, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    page = mount();
    await page.renderApp();
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
});

describe('the git button in the toolbar', () => {
    test('carries a dot and says how many changes the checkout has while the panel is closed', async () => {
        await until(() => gitButton()?.getAttribute('aria-label') === 'Git, 2 changes');
        expect(dotOn(gitButton())).toBe(true);
        expect(machine.requests('git.watch')).toContainEqual({ cwd: FOLDER, status: true });
    });

    test('loses the dot once the checkout is clean again', async () => {
        await until(() => dotOn(gitButton()));
        await act(async () => machine.emit('git.status', { cwd: FOLDER, status: status([]) }));
        await until(() => gitButton()?.getAttribute('aria-label') === 'Git');
        expect(dotOn(gitButton())).toBe(false);
    });
});
