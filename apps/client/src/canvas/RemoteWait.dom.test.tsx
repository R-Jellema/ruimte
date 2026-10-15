import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { ProjectCanvasView, ProjectNode, RemoteStatusEvent, Task } from '@ruimte/contracts';
import { LOCAL_ENDPOINT_ID, useEndpoints } from '@/state/endpoints';
import { useAttention } from '@/state/attention';
import { startRemoteStatusWatch } from '@/state/remote-status';
import { useTasks } from '@/state/tasks';
import { connectFakeMachine, FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';

const WORKSPACE = 'fake-machine';
const REMOTE = 'machine-b';
const PARENT: ProjectNode = { id: 'parent', kind: 'terminal', title: 'Parent', x: 0, y: 0, w: 560, h: 360 };
const CHILD: ProjectNode = { id: 'child', kind: 'terminal', title: 'Child', x: 700, y: 0, w: 560, h: 360, machine: REMOTE };
const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [PARENT, CHILD], texts: [], edges: [], layouts: [] };

const TASK: Task = {
    id: 'task-1',
    projectId: 'project-atlas',
    parentId: PARENT.id,
    childId: CHILD.id,
    title: 'Run the tests',
    prompt: 'Run the tests',
    status: 'open',
    result: null,
    createdAt: 1,
    settledAt: null,
    wake: 'pending'
};

let here: FakeMachine;
let there: FakeMachine;
let disconnectThere: () => void;
let workspace: FakeWorkspace;
let page: Mounted;
let stopWatching: () => void;

function status(state: RemoteStatusEvent['state']): RemoteStatusEvent {
    return { machineId: REMOTE, state, owed: 1, ...(state === 'waiting' ? { nextAttemptAt: 60_000 } : {}) };
}

function pillOf(nodeId: string): string {
    return page.host.querySelector(`[data-node-id="${nodeId}"] header`)?.textContent ?? '';
}

beforeEach(async () => {
    here = new FakeMachine();
    there = new FakeMachine();
    useEndpoints.getState().add({
        id: REMOTE,
        label: 'MacBook Pro',
        httpBaseUrl: 'http://127.0.0.1:2',
        wsBaseUrl: 'ws://127.0.0.1:2',
        reachability: 'lan',
        daemonId: null,
        daemonPublicKey: null
    });
    disconnectThere = connectFakeMachine(there, REMOTE);
    workspace = await openFakeWorkspace(here, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    stopWatching = startRemoteStatusWatch();
    page = mount();
    await page.renderApp();
    await until(() => page.host.querySelector(`[data-node-id="${CHILD.id}"]`) !== null);
    await act(async () => useTasks.getState().putTask(WORKSPACE, TASK));
});

afterEach(async () => {
    stopWatching();
    useTasks.getState().forget(WORKSPACE);
    await page.unmount();
    workspace.close();
    disconnectThere();
    useEndpoints.getState().setActive(LOCAL_ENDPOINT_ID);
    useEndpoints.getState().remove(REMOTE);
});

describe('a task that waits for another machine', () => {
    test('shows a pill on the parent while the machine does not answer, and takes it away when the link opens', async () => {
        expect(pillOf(PARENT.id)).not.toContain('Waiting for');
        await act(async () => here.emit('remote.status', status('waiting')));
        await until(() => pillOf(PARENT.id).includes('Waiting for MacBook Pro'));
        expect(pillOf(CHILD.id)).not.toContain('Waiting for');

        await act(async () => here.emit('remote.status', status('open')));
        await until(() => !pillOf(PARENT.id).includes('Waiting for'));
    });

    test('shows no pill once the task has settled, and counts nothing as needing a person', async () => {
        await act(async () => here.emit('remote.status', status('waiting')));
        await until(() => pillOf(PARENT.id).includes('Waiting for MacBook Pro'));
        expect(Object.keys(useAttention.getState().unseen)).toEqual([]);

        await act(async () => useTasks.getState().putTask(WORKSPACE, { ...TASK, status: 'done', settledAt: 2 }));
        await until(() => !pillOf(PARENT.id).includes('Waiting for'));
    });

    test('offers Stop waiting on the node that waits, and stops its task', async () => {
        await act(async () => here.emit('remote.status', status('waiting')));
        await until(() => pillOf(PARENT.id).includes('Waiting for MacBook Pro'));
        const frame = page.host.querySelector(`[data-node-id="${CHILD.id}"]`)!;
        await act(async () => {
            frame.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 800, clientY: 100, button: 2 }));
        });
        await until(() => document.querySelector('[role="menu"]') !== null);
        const item = ([...document.querySelectorAll('[role="menuitem"]')] as HTMLElement[]).find((entry) => entry.textContent?.includes('Stop waiting'));
        expect(item).toBeDefined();
        await clickOn(item ?? null);
        await until(() => here.requests('chat.stopTask').length > 0);
        expect(here.requests('chat.stopTask')[0]).toEqual({ chatId: PARENT.id, taskId: TASK.id });
    });

    test('offers no Stop waiting while the link is open', async () => {
        await act(async () => here.emit('remote.status', status('open')));
        const frame = page.host.querySelector(`[data-node-id="${CHILD.id}"]`)!;
        await act(async () => {
            frame.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 800, clientY: 100, button: 2 }));
        });
        await until(() => document.querySelector('[role="menu"]') !== null);
        expect(document.querySelector('[role="menu"]')?.textContent).not.toContain('Stop waiting');
    });
});
