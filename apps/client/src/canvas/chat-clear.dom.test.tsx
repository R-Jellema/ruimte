import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { ProjectCanvasView, ProjectNode } from '@ruimte/contracts';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';

const REVIEW: ProjectNode = { id: 'review', kind: 'chat', title: 'Review', x: 0, y: 0, w: 480, h: 520 };
const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [REVIEW], texts: [], edges: [], layouts: [] };

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function menuItem(text: string): HTMLElement | null {
    return ([...document.querySelectorAll('[role="menuitem"]')] as HTMLElement[]).find((item) => item.textContent?.includes(text)) ?? null;
}

function dialogButton(text: string): HTMLElement | null {
    return ([...document.querySelectorAll('[role="dialog"] button')] as HTMLElement[]).find((button) => button.textContent?.includes(text)) ?? null;
}

async function askToClear(): Promise<void> {
    const frame = page.host.querySelector(`[data-node-id="${REVIEW.id}"]`)!;
    await act(async () => {
        frame.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40, button: 2 }));
    });
    await until(() => menuItem('Clear') !== null);
    await clickOn(menuItem('Clear'));
    await until(() => document.querySelector('[role="dialog"]') !== null);
}

beforeEach(async () => {
    machine = new FakeMachine();
    machine.answer('project.save', ({ baseRev }) => ({ rev: baseRev + 1 }) as never);
    machine.answer('agent.children', () => ({ nodeIds: ['helper'] }));
    machine.answer('chat.clear', ({ chatId }) => ({ chatId }) as never);
    workspace = await openFakeWorkspace(machine, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    page = mount();
    await page.renderApp();
    await until(() => page.host.querySelector(`[data-node-id="${REVIEW.id}"]`) !== null);
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
});

describe('Clear on a chat node', () => {
    test('asks first, names the agents it ends, and a confirmation clears the chat once', async () => {
        await askToClear();
        expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Clear Review?');
        expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Also ends the agent it opened');
        expect(machine.requests('chat.clear')).toEqual([]);

        await clickOn(dialogButton('Clear'));
        await until(() => machine.requests('chat.clear').length === 1);
        expect(machine.requests('chat.clear')).toEqual([{ chatId: REVIEW.id, force: true }]);
    });

    test('cancelling sends nothing', async () => {
        await askToClear();
        await clickOn(dialogButton('Cancel'));

        await until(() => document.querySelector('[role="dialog"]') === null);
        expect(machine.requests('chat.clear')).toEqual([]);
    });
});
