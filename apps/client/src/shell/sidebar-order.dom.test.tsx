import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { ProjectSummary } from '@ruimte/contracts';
import { SIDEBAR_ORDER_STORAGE_KEY, useSidebarProjects } from '@/shell/sidebar-projects';
import { useSettings } from '@/state/settings';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';

const BOREALIS: ProjectSummary = {
    projectId: 'project-borealis',
    name: 'Borealis',
    color: '#000',
    folder: '/work/borealis',
    lastOpenedAt: 0,
    closedAt: null,
    available: true,
    icon: { kind: 'initial', value: 'B' },
    nameSource: 'chosen'
};

const previousScope = useSettings.getState().sidebarScope;

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

/* The project headings of the sidebar, top to bottom, by name. */
function headings(): string[] {
    return [...page.host.querySelectorAll<HTMLElement>('[data-sidebar-row^="project:"]')].map((row) => row.getAttribute('aria-label')?.split(' · ')[0] ?? '');
}

function heading(name: string): HTMLElement | null {
    return (
        [...page.host.querySelectorAll<HTMLElement>('[data-sidebar-row^="project:"]')].find((row) => row.getAttribute('aria-label')?.startsWith(name)) ?? null
    );
}

function menuItem(text: string): HTMLElement | null {
    return ([...document.querySelectorAll('[role="menuitem"]')] as HTMLElement[]).find((item) => item.textContent?.trim().startsWith(text)) ?? null;
}

beforeEach(async () => {
    localStorage.removeItem(SIDEBAR_ORDER_STORAGE_KEY);
    useSidebarProjects.setState({ order: [] });
    machine = new FakeMachine();
    workspace = await openFakeWorkspace(machine, { views: [] } as never, { activeViewId: null, views: {} } as never);
    machine.emit('project.summary', { summary: BOREALIS } as never);
    useSettings.setState({ sidebarScope: 'all-open' });
    page = mount();
    await page.renderApp();
    await until(() => headings().length === 2);
});

afterEach(async () => {
    await page.unmount();
    useSettings.setState({ sidebarScope: previousScope });
    workspace.close();
    localStorage.removeItem(SIDEBAR_ORDER_STORAGE_KEY);
});

describe('the order of all open projects', () => {
    test('Move up puts a project above the one before it, and this client keeps that order', async () => {
        const [first, second] = headings();
        await act(async () => {
            heading(second!)!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10, button: 2 }));
        });
        await until(() => menuItem('Move up') !== null);
        expect(menuItem('Move up')!.getAttribute('aria-disabled')).not.toBe('true');
        await clickOn(menuItem('Move up'));
        await until(() => headings()[0] === second);
        expect(headings()).toEqual([second, first]);
        const stored = JSON.parse(localStorage.getItem(SIDEBAR_ORDER_STORAGE_KEY) ?? '[]') as string[];
        expect(stored.map((key) => (JSON.parse(key) as string[])[1])).toEqual(
            [second, first].map((name) => (name === 'Borealis' ? 'project-borealis' : 'project-atlas'))
        );
    });
});
