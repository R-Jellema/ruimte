import { afterEach, beforeEach, describe, test } from 'bun:test';
import { act } from 'react';
import type { ProjectCanvasView, ProjectNode } from '@ruimte/contracts';
import { isApplePlatform } from '@/desktop/bridge';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { mount, pressKey, until, type Mounted } from '../../testing/dom';

const SHELL: ProjectNode = { id: 'shell', kind: 'terminal', title: 'Shell', x: 0, y: 0, w: 560, h: 360 };
const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [SHELL], texts: [], edges: [], layouts: [] };

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

beforeEach(async () => {
    machine = new FakeMachine();
    machine.answer('project.save', ({ baseRev }) => ({ rev: baseRev + 1 }) as never);
    workspace = await openFakeWorkspace(machine, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    page = mount();
    await page.renderApp();
    await until(() => page.host.querySelector(`[data-node-id="${SHELL.id}"] textarea`) !== null);
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
});

describe('find in a terminal node', () => {
    test("the platform's find key in the terminal opens the find bar, and Escape closes it again", async () => {
        const apple = isApplePlatform();
        const textarea = page.host.querySelector(`[data-node-id="${SHELL.id}"] textarea`)!;
        await act(async () => (textarea as HTMLElement).focus());

        await pressKey(textarea, apple ? 'f' : 'F', apple ? { metaKey: true } : { ctrlKey: true, shiftKey: true });
        await until(() => page.host.querySelector('[data-find-bar]') !== null);

        const field = page.host.querySelector<HTMLInputElement>('[data-find-bar] input')!;
        await pressKey(field, 'Escape');
        await until(() => page.host.querySelector('[data-find-bar]') === null);
    });
});
