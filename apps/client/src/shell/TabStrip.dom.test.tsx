import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { ProjectView } from '@ruimte/contracts';
import { useFiles } from '@/state/files';
import { useDocument } from '@/state/document';
import { useViewPins } from '@/state/view-pins';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';

const CHAT: ProjectView = { kind: 'chat', id: 'chat-view', name: 'Notes chat', node: {} };
const SHELL: ProjectView = { kind: 'terminal', id: 'shell-view', name: 'Shell', node: {} };
const FILE = '/work/atlas/src/a.ts';

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function tab(id: string): HTMLElement | null {
    return page.host.querySelector<HTMLElement>(`[data-tab-id="${id}"]`);
}

function tabIds(): string[] {
    // The strip measures its tabs in copies of its own, so a tab can be in the page more than once.
    return [...new Set([...page.host.querySelectorAll<HTMLElement>('[data-tab-id]')].map((element) => element.dataset.tabId ?? ''))];
}

/* A host left with one view of the project is a plain cell again, without a strip. */
function chatCell(): Element | null {
    return page.host.querySelector(`[data-split-cell][data-view-id="${CHAT.id}"]`);
}

function menuItem(text: string): HTMLElement | null {
    return ([...document.querySelectorAll('[role="menuitem"]')] as HTMLElement[]).find((item) => item.textContent?.trim().startsWith(text)) ?? null;
}

async function openMenuOf(element: HTMLElement | null): Promise<void> {
    expect(element).not.toBeNull();
    await act(async () => {
        element!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40, button: 2 }));
    });
    await until(() => document.querySelector('[role="menu"]') !== null);
}

beforeEach(async () => {
    machine = new FakeMachine();
    machine.answer('fs.read', () => ({ kind: 'text', text: 'export {};\n', encoding: 'utf-8', size: 11, mtime: 1, language: 'typescript' }) as never);
    useViewPins.setState({ pins: {} });
    workspace = await openFakeWorkspace(machine, { views: [CHAT, SHELL] } as never, { activeViewId: CHAT.id, views: {} });
    page = mount();
    await page.renderApp();
    await until(() => chatCell() !== null);
    await act(async () => {
        useDocument.getState().dropViewAsTab(SHELL.id, { column: 0, cell: 0 }, null);
    });
    await until(() => tab(CHAT.id) !== null && tab(SHELL.id) !== null);
    await act(async () => useFiles.getState().open(FILE, 10));
    await until(() => tab(FILE) !== null);
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
    useViewPins.setState({ pins: {} });
});

describe('the tabs of a host', () => {
    test('"Close other tabs" on a file takes the chat and the terminal off the screen and leaves them in the project', async () => {
        expect(tabIds()).toEqual([CHAT.id, SHELL.id, FILE]);
        await openMenuOf(tab(FILE));
        await clickOn(menuItem('Close other tabs'));
        await until(() => tabIds().length === 1);
        expect(tabIds()).toEqual([FILE]);
        expect(page.host.querySelector(`[data-sidebar-row="view:${CHAT.id}"]`)).not.toBeNull();
        expect(page.host.querySelector(`[data-sidebar-row="view:${SHELL.id}"]`)).not.toBeNull();
        expect(machine.requests('session.kill')).toEqual([]);
    });

    test('a chat offers the same ways to close tabs as a file', async () => {
        await openMenuOf(tab(CHAT.id));
        expect(menuItem('Pin tab')).not.toBeNull();
        await clickOn(menuItem('Close tabs to the right'));
        await until(() => tab(FILE) === null && tab(SHELL.id) === null);
        expect(chatCell()).not.toBeNull();
        expect(page.host.querySelector(`[data-sidebar-row="view:${SHELL.id}"]`)).not.toBeNull();
    });

    test('a pinned chat stays when every tab closes', async () => {
        await openMenuOf(tab(CHAT.id));
        await clickOn(menuItem('Pin tab'));
        await openMenuOf(tab(SHELL.id));
        await clickOn(menuItem('Close all tabs'));
        await until(() => tab(FILE) === null && tab(SHELL.id) === null);
        expect(chatCell()).not.toBeNull();
    });
});
