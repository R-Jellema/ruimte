import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { ProjectCanvasView, ProjectNode } from '@ruimte/contracts';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';

const SHELL: ProjectNode = { id: 'shell', kind: 'terminal', title: 'Shell', x: 0, y: 0, w: 560, h: 360 };
const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [SHELL], texts: [], edges: [], layouts: [] };

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function menuItem(text: string): HTMLElement | null {
    return ([...document.querySelectorAll('[role="menuitem"]')] as HTMLElement[]).find((item) => item.textContent?.includes(text)) ?? null;
}

async function openMenuOf(selector: string): Promise<void> {
    const target = page.host.querySelector(selector)!;
    await act(async () => {
        target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40, button: 2 }));
    });
    await until(() => document.querySelector('[role="menu"]') !== null);
}

beforeEach(async () => {
    machine = new FakeMachine();
    machine.answer('project.save', ({ baseRev }) => ({ rev: baseRev + 1 }) as never);
    workspace = await openFakeWorkspace(machine, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    page = mount();
    await page.renderApp();
    await until(() => page.host.querySelector(`[data-node-id="${SHELL.id}"]`) !== null);
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
});

describe('Clear on a terminal', () => {
    test('the menu of its frame clears the session once', async () => {
        await openMenuOf(`[data-node-id="${SHELL.id}"]`);
        await clickOn(menuItem('Clear'));

        await until(() => machine.requests('session.clear').length === 1);
        expect(machine.requests('session.clear')).toEqual([{ sessionId: SHELL.id }]);
    });

    test('the menu inside the terminal clears the session once', async () => {
        await until(() => page.host.querySelector(`[data-node-id="${SHELL.id}"] .bg-term-bg`) !== null);
        await openMenuOf(`[data-node-id="${SHELL.id}"] .bg-term-bg`);
        expect(menuItem('Paste')).not.toBeNull();
        await clickOn(menuItem('Clear'));

        await until(() => machine.requests('session.clear').length === 1);
        expect(machine.requests('session.clear')).toEqual([{ sessionId: SHELL.id }]);
    });
});
