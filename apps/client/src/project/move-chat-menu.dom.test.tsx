import { afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { REQUEST_SCHEMAS, type ChatInfo, type ProjectView, type RequestType } from '@ruimte/contracts';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { useChats } from '@adecore/agents-react/state';
import { useUi } from '@/state/ui';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';

const WRITTEN: ProjectView = { kind: 'chat', id: 'written', name: 'Vinyl notes', node: {} };

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

async function open(summary: { scratch?: boolean }, features?: RequestType[]): Promise<void> {
    machine = new FakeMachine();
    if (features !== undefined) {
        machine.answersOnly(features);
    }
    workspace = await openFakeWorkspace(machine, { views: [WRITTEN] }, { activeViewId: WRITTEN.id, views: {} }, summary);
    page = mount();
    await page.renderApp();
}

function menuLabels(): string[] {
    return ([...document.querySelectorAll('[role="menuitem"]')] as HTMLElement[]).map((item) => item.textContent ?? '');
}

/* The fake machine answers every chat as running; a test that needs it quiet says so. */
async function setChatStatus(status: 'idle' | 'running' | 'needs-you', patch: Partial<ChatInfo> = {}): Promise<void> {
    await act(async () => {
        useChats.setState((state) => ({
            byKey: Object.fromEntries(Object.entries(state.byKey).map(([key, row]) => [key, { ...row, info: { ...row.info, status, ...patch } }]))
        }));
    });
}

function makeProjectRow(): HTMLElement | undefined {
    return ([...document.querySelectorAll('[role="menuitem"]')] as HTMLElement[]).find((item) => item.textContent?.includes('Make a project'));
}

async function openViewMenu(viewId: string): Promise<void> {
    await until(() => page.host.querySelector(`[data-sidebar-row="view:${viewId}"]`) !== null);
    const row = page.host.querySelector(`[data-sidebar-row="view:${viewId}"]`)!;
    await act(async () => {
        row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40, button: 2 }));
    });
    await until(() => menuLabels().length > 0);
}

afterEach(async () => {
    await page.unmount();
    workspace.close();
});

describe('moving a chat out of Chats, from its view menu', () => {
    test('a chat someone wrote in offers a project and a move', async () => {
        await open({ scratch: true });
        await openViewMenu(WRITTEN.id);
        expect(menuLabels()).toEqual(expect.arrayContaining([expect.stringContaining('Make a project…'), expect.stringContaining('Move to project')]));
    });

    test('"Make a project…" asks for the dialog on this chat with no project picked', async () => {
        await open({ scratch: true });
        await setChatStatus('idle');
        await openViewMenu(WRITTEN.id);
        await clickOn(makeProjectRow() ?? null);
        expect(useUi.getState().moveChatDialog).toEqual({ chatId: WRITTEN.id, mode: 'make', projectId: null });
        useUi.getState().setMoveChatDialog(null);
    });

    test('both rows are off while the chat works', async () => {
        await open({ scratch: true });
        await setChatStatus('needs-you');
        await openViewMenu(WRITTEN.id);
        expect(makeProjectRow()?.getAttribute('aria-disabled')).toBe('true');
        await clickOn(makeProjectRow() ?? null);
        expect(useUi.getState().moveChatDialog).toBeNull();
    });

    test.each([
        ['a subagent in the background', { delegating: true }],
        ['a goal', { goal: { status: 'active' } }],
        ['a message in the queue', { queue: [{ id: 'q1' }] }]
    ] as const)('both rows are off while the chat is idle but has %s', async (_name, patch) => {
        await open({ scratch: true });
        await setChatStatus('idle', patch as unknown as Partial<ChatInfo>);
        await openViewMenu(WRITTEN.id);
        expect(makeProjectRow()?.getAttribute('aria-disabled')).toBe('true');
    });

    test('a chat in a project offers neither', async () => {
        await open({});
        await openViewMenu(WRITTEN.id);
        expect(menuLabels().some((label) => label.includes('Make a project'))).toBe(false);
    });

    test('a machine that does not answer chat.move offers neither', async () => {
        await open(
            { scratch: true },
            (Object.keys(REQUEST_SCHEMAS) as RequestType[]).filter((type) => type !== 'chat.move')
        );
        await openViewMenu(WRITTEN.id);
        expect(menuLabels().some((label) => label.includes('Make a project'))).toBe(false);
    });
});
