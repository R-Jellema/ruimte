import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { EndpointInfo, NodeSizes, ProjectCanvasView, ProjectNode } from '@ruimte/contracts';
import { startEndpointWatch } from '@/endpoint/watch';
import { serverInfoOf, useServers } from '@/state/server';
import { useUi } from '@/state/ui';
import { windowWorkspace } from '@/state/window';
import { startServerInfo } from '@/transport/server-info';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';

const MACHINE = 'fake-machine';
const PLAN: ProjectNode = { id: 'plan', kind: 'note', title: 'Plan', body: 'Ship it', x: 0, y: 0, w: 400, h: 320 };
const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [PLAN], texts: [], edges: [], layouts: [] };

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;
let sizes: NodeSizes;
let stops: Array<() => void>;

function info(features: string[]): EndpointInfo {
    return {
        id: MACHINE,
        label: 'Fake machine',
        platform: 'darwin',
        version: '1',
        reachability: 'lan',
        authenticated: true,
        nodeSizes: sizes,
        features
    };
}

/* A machine that keeps sizes, or one from before them when `keeps` is false. */
async function open(keeps: boolean): Promise<void> {
    const features = keeps ? ['endpoint.info', 'endpoint.setNodeSize'] : ['endpoint.info'];
    machine.answer('endpoint.info', () => info(features));
    machine.answer('endpoint.setNodeSize', ({ kind, size }) => {
        const { [kind]: _replaced, ...others } = sizes;
        sizes = size === null ? others : { ...others, [kind]: size };
        return info(features);
    });
    workspace = await openFakeWorkspace(machine, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    stops = [startServerInfo(), startEndpointWatch()];
    page = mount();
    await page.renderApp();
    await until(() => serverInfoOf(MACHINE).features !== null && page.host.querySelector(`[data-node-id="${PLAN.id}"]`) !== null);
}

async function openNodeMenu(id: string): Promise<void> {
    const frame = page.host.querySelector(`[data-node-id="${id}"]`)!;
    await act(async () => {
        frame.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40, button: 2 }));
    });
    await until(() => document.querySelector('[role="menu"]') !== null);
}

function menuItem(text: string): HTMLElement | null {
    return ([...document.querySelectorAll('[role="menuitem"]')] as HTMLElement[]).find((item) => item.textContent?.includes(text)) ?? null;
}

function savedNodes(): ProjectNode[] {
    const view = machine
        .requests('project.save')
        .at(-1)
        ?.content.views.find((candidate) => candidate.id === MAIN.id);
    return view?.kind === 'canvas' ? (view.nodes ?? []) : [];
}

async function pasteText(text: string): Promise<void> {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', text);
    await act(async () => {
        document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
    });
}

function settingsSection(): HTMLElement | null {
    return (
        ([...document.querySelectorAll('section, [data-settings-section]')] as HTMLElement[]).find((section) =>
            section.textContent?.includes('New nodes on Fake machine')
        ) ?? null
    );
}

beforeEach(() => {
    machine = new FakeMachine();
    machine.answer('project.save', ({ baseRev }) => ({ rev: baseRev + 1 }) as never);
    sizes = {};
    stops = [];
});

afterEach(async () => {
    await act(async () => useUi.getState().setSettings({ open: false }));
    await page.unmount();
    stops.forEach((stop) => stop());
    workspace.close();
    useServers.getState().forget(MACHINE);
});

describe('a default size per node kind', () => {
    test('a node’s menu makes its frame the size of its kind on the machine, says so, and the next node of that kind takes it', async () => {
        await open(true);
        await openNodeMenu(PLAN.id);
        const item = menuItem('Make this the default size');
        expect(item?.textContent).toContain('400 × 320');
        await clickOn(item);

        await until(() => machine.requests('endpoint.setNodeSize').length === 1);
        expect(machine.requests('endpoint.setNodeSize')).toEqual([{ kind: 'note', size: { w: 400, h: 320 } }]);
        await until(() => document.body.textContent?.includes('Note nodes now start at 400 × 320') === true);

        await pasteText('Call the printer');
        await act(async () => windowWorkspace()!.connection.projects.flush());
        const pasted = savedNodes().find((node) => node.id !== PLAN.id);
        expect(pasted).toMatchObject({ kind: 'note', w: 400, h: 320 });
    });

    test('a machine from before default sizes offers no such item and no section', async () => {
        await open(false);
        await openNodeMenu(PLAN.id);
        expect(menuItem('Rename')).not.toBeNull();
        expect(menuItem('Make this the default size')).toBeNull();

        await act(async () => useUi.getState().setSettings({ open: true, section: 'views' }));
        await until(() => document.body.textContent?.includes('Snap to the grid') === true);
        expect(document.body.textContent).not.toContain('New nodes on Fake machine');
    });

    test('settings list only the kinds with a size of their own, and Reset puts one back to the built-in size', async () => {
        sizes = { terminal: { w: 640, h: 400 } };
        await open(true);
        await act(async () => useUi.getState().setSettings({ open: true, section: 'views' }));
        await until(() => settingsSection() !== null);

        const section = settingsSection()!;
        expect(section.textContent).toContain('Terminal');
        expect(section.textContent).toContain('640 × 400, built in 560 × 360');
        expect(section.textContent).not.toContain('Chat');
        expect(section.textContent).not.toContain('New nodes use the built-in size of their kind.');

        await clickOn(section.querySelector('button[aria-label="Reset the size of Terminal nodes on Fake machine"]'));
        await until(() => settingsSection()?.textContent?.includes('New nodes use the built-in size of their kind.') === true);
        expect(machine.requests('endpoint.setNodeSize')).toEqual([{ kind: 'terminal', size: null }]);
        expect(settingsSection()!.textContent).not.toContain('640 × 400');
    });
});
