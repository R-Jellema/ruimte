import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { ProjectSummary } from '@ruimte/contracts';
import type { DesktopBridge } from '@/desktop/bridge';
import { startWindowTabs } from '@/project/window-tabs';
import { useSettings } from '@/state/settings';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';

const SHOWN = 'fake-machine:project-atlas';
const BEHIND = 'fake-machine:project-borealis';

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

/* The shell as it stands: a window detaches only a project it shows or keeps, and hears the page in the order it sent. */
interface FakeShell {
    bridge: DesktopBridge;
    heard: string[];
}

function fakeShell(): FakeShell {
    const heard: string[] = [];
    let kept: string[] = [];
    const bridge: DesktopBridge = {
        platform: 'darwin',
        pickFolder: async () => null,
        openExternal: async () => undefined,
        openGuestDevTools: () => undefined,
        isFullscreen: async () => false,
        onFullscreen: () => () => undefined,
        openWindow: (key) => void heard.push(`open ${key}`),
        holdTabs: async (keys) => {
            kept = [...keys];
            return keys;
        },
        tabDrag: async (phase, key) => {
            if (phase === 'end') {
                heard.push(`end ${key}`);
                return true;
            }
            const has = key === SHOWN || kept.includes(key);
            kept = kept.filter((one) => one !== key);
            heard.push(`${phase} ${key} ${has ? 'detached' : 'refused'}`);
            return has;
        }
    };
    return { bridge, heard };
}

const scope = globalThis as unknown as { window: { ruimteDesktop?: DesktopBridge } };
const previousNavigation = useSettings.getState().projectNavigation;

let machine: FakeMachine;
let workspace: FakeWorkspace;
let shell: FakeShell;
let stopTabs: () => void;
let page: Mounted;

function tab(key: string): HTMLElement | null {
    return page.host.querySelector<HTMLElement>(`[data-tab-key="${key}"]`);
}

/* A press on a tab carried down and out of the strip, the way a person tears a tab off. */
async function dragOut(element: HTMLElement): Promise<void> {
    const at = (type: string, y: number) => new PointerEvent(type, { pointerId: 1, button: 0, clientX: 10, clientY: y, bubbles: true, cancelable: true });
    await act(async () => {
        element.dispatchEvent(at('pointerdown', 0));
    });
    await act(async () => {
        element.dispatchEvent(at('pointermove', 10));
    });
    await act(async () => {
        element.dispatchEvent(at('pointermove', 200));
    });
    await act(async () => {
        window.dispatchEvent(at('pointerup', 200));
    });
}

beforeEach(async () => {
    machine = new FakeMachine();
    workspace = await openFakeWorkspace(machine, { views: [] } as never, { activeViewId: null, views: {} } as never);
    machine.emit('project.summary', { summary: BOREALIS } as never);
    shell = fakeShell();
    scope.window.ruimteDesktop = shell.bridge;
    history.replaceState(null, '', `?state=${encodeURIComponent(JSON.stringify([BEHIND, SHOWN]))}`);
    useSettings.setState({ projectNavigation: 'tabs' });
    stopTabs = startWindowTabs();
    page = mount();
    await page.renderApp();
    await until(() => tab(SHOWN) !== null && tab(BEHIND) !== null);
});

afterEach(async () => {
    await page.unmount();
    stopTabs();
    useSettings.setState({ projectNavigation: previousNavigation });
    history.replaceState(null, '', location.pathname);
    delete scope.window.ruimteDesktop;
    workspace.close();
});

describe('tearing a project tab out of its window', () => {
    test('a tab in the back goes into a window of its own, and the window keeps showing its project', async () => {
        expect(tab(SHOWN)!.getAttribute('aria-selected')).toBe('true');
        await dragOut(tab(BEHIND)!);
        await until(() => shell.heard.includes(`end ${BEHIND}`));
        expect(shell.heard).toEqual([`start ${BEHIND} detached`, `end ${BEHIND}`]);
        expect(tab(BEHIND)).toBeNull();
        expect(tab(SHOWN)!.getAttribute('aria-selected')).toBe('true');
        expect(page.host.textContent).toContain('Atlas');
        expect(machine.requests('project.open')).toHaveLength(1);
    });
});

function tabOrder(): string[] {
    return [...page.host.querySelectorAll<HTMLElement>('[data-tab-key]')].map((element) => element.dataset.tabKey ?? '');
}

function menuItem(text: string): HTMLElement | null {
    return ([...document.querySelectorAll('[role="menuitem"]')] as HTMLElement[]).find((item) => item.textContent?.trim().startsWith(text)) ?? null;
}

async function openTabMenu(key: string): Promise<void> {
    await act(async () => {
        tab(key)!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10, button: 2 }));
    });
    await until(() => document.querySelector('[role="menu"]') !== null);
}

describe('pinning a project tab', () => {
    test('a pinned tab moves to the front, loses its close button and its name, and is kept in the address of the window', async () => {
        expect(tabOrder()).toEqual([BEHIND, SHOWN]);
        await openTabMenu(SHOWN);
        await clickOn(menuItem('Pin tab'));
        await until(() => tab(SHOWN)?.hasAttribute('data-pinned') === true);
        expect(tabOrder()).toEqual([SHOWN, BEHIND]);
        expect(tab(SHOWN)!.querySelector('button')).toBeNull();
        expect(tab(SHOWN)!.textContent).not.toContain('Atlas');
        expect(new URLSearchParams(location.search).get('state')).toBe(JSON.stringify({ tabs: [SHOWN, BEHIND], pinned: [SHOWN] }));
    });

    test('Unpin tab gives a tab its name and its close button back', async () => {
        await openTabMenu(SHOWN);
        await clickOn(menuItem('Pin tab'));
        await until(() => tab(SHOWN)?.hasAttribute('data-pinned') === true);
        await openTabMenu(SHOWN);
        await clickOn(menuItem('Unpin tab'));
        await until(() => tab(SHOWN)?.hasAttribute('data-pinned') === false);
        expect(tab(SHOWN)!.textContent).toContain('Atlas');
    });
});
