import { afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { EditorView } from '@codemirror/view';
import type { ProviderInfo } from '@ruimte/contracts';
import { useRoutineForm } from '@/routines/form-state';
import { chatInfoOf } from '../../testing/chat-info';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';

const CLAUDE = {
    kind: 'claude',
    name: 'Claude Code',
    installed: true,
    version: '2.1.0',
    models: [{ slug: 'model', name: 'Model', legacy: false, isDefault: true, options: [] }],
    defaultModel: 'model',
    capabilities: { chat: true, terminal: true, hooks: true, diffs: 'before-after', slashCommands: true },
    resumeCommand: 'claude --resume {id}'
} as unknown as ProviderInfo;

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

async function open(answersRoutines: boolean): Promise<void> {
    machine = new FakeMachine();
    machine.answer('provider.list', () => ({ providers: [CLAUDE] }));
    machine.answer('chat.attach', ({ chatId }) => ({ info: chatInfoOf(chatId, { provider: 'claude' }), items: [], seq: 0 }) as never);
    if (answersRoutines) {
        machine.answer('routine.list', () => ({ routines: [], revs: {}, timeZone: 'Europe/Amsterdam' }));
    }
    workspace = await openFakeWorkspace(machine, { views: [{ kind: 'chat', id: 'summary', name: 'Summary', node: { provider: 'claude' } }] } as never, {
        activeViewId: 'summary',
        views: {}
    });
    page = mount();
    await page.renderApp();
}

function composer(): EditorView | null {
    const content = page.host.querySelector('[data-split-cell][data-view-id="summary"] .cm-content');
    return content === null ? null : EditorView.findFromDOM(content as HTMLElement);
}

/* What the editor gets when a person types, without the layout a browser would measure first. */
async function type(words: string): Promise<void> {
    await act(async () => {
        const view = composer()!;
        view.dispatch(view.state.replaceSelection(words), { userEvent: 'input.type' });
    });
}

function chevron(): HTMLElement | null {
    return document.querySelector<HTMLElement>('button[aria-label="More send options"]');
}

afterEach(async () => {
    await act(async () => useRoutineForm.setState({ request: null }));
    await page.unmount();
    workspace.close();
});

describe('Repeat… at the send button', () => {
    test("opens the routine form with what is being written, in the chat's project", async () => {
        await open(true);
        await until(() => composer() !== null);
        await type('Summarize what changed on main.');
        await until(() => chevron() !== null);
        await clickOn(chevron());
        const repeat = (): HTMLElement | null =>
            ([...document.querySelectorAll('[role="menuitem"]')] as HTMLElement[]).find((item) => item.textContent?.includes('Repeat…')) ?? null;
        await until(() => repeat() !== null);
        await clickOn(repeat());
        await until(() => useRoutineForm.getState().request !== null);
        expect(useRoutineForm.getState().request).toMatchObject({
            projectId: 'project-atlas',
            prompt: 'Summarize what changed on main.',
            agent: { provider: 'claude' }
        });
        expect(machine.requests('chat.send')).toEqual([]);
    });

    test('is not offered by a machine that has no routines', async () => {
        await open(false);
        await until(() => composer() !== null);
        await until(() => machine.requests('provider.list').length > 0);
        expect(chevron()).toBeNull();
    });
});
