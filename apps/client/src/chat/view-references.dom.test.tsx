import { afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { EditorView } from '@codemirror/view';
import type { EndpointInfo, ProjectView, ProviderInfo } from '@ruimte/contracts';
import { useServers } from '@/state/server';
import { startServerInfo } from '@/transport/server-info';
import { chatInfoOf } from '../../testing/chat-info';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { clickOn, mount, pressKey, until, type Mounted } from '../../testing/dom';

const MACHINE = 'fake-machine';

// Named apart from the other chat tests, so no draft of theirs is in this composer.
const LEAD: ProjectView = { kind: 'chat', id: 'chat-refs-lead', name: 'Lead', node: { provider: 'claude' } };
const PLANNER: ProjectView = { kind: 'chat', id: 'chat-refs-planner', name: 'Planner', node: { provider: 'claude' } };
const SKETCH: ProjectView = { kind: 'drawing', id: 'drawing-schets', name: 'Schets' };

const CLAUDE = {
    kind: 'claude',
    name: 'Claude Code',
    installed: true,
    version: '2.1.0',
    models: [{ slug: 'model', name: 'Model', legacy: false, isDefault: true, options: [] }],
    defaultModel: 'model',
    capabilities: { chat: true, terminal: true, hooks: true, attachments: true, mentions: true, slashCommands: true },
    resumeCommand: 'claude --resume {id}'
} as unknown as ProviderInfo;

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;
let stopInfo: () => void;

afterEach(async () => {
    stopInfo();
    await page.unmount();
    workspace.close();
});

/* A machine that says whether it resolves references, with the lead chat in front. */
async function open(viewReferences: boolean): Promise<void> {
    machine = new FakeMachine();
    const info: EndpointInfo = {
        id: MACHINE,
        label: 'Fake machine',
        platform: 'darwin',
        version: '1',
        reachability: 'lan',
        authenticated: true,
        viewReferences
    };
    machine.answer('endpoint.info', () => info);
    machine.answer('provider.list', () => ({ providers: [CLAUDE] }));
    machine.answer('chat.attach', ({ chatId }) => ({ info: chatInfoOf(chatId), items: [], seq: 0 }) as never);
    machine.answer('chat.send', () => ({ queued: false, turnId: 'turn-1' }));
    workspace = await openFakeWorkspace(machine, { views: [LEAD, PLANNER, SKETCH] } as never, { activeViewId: LEAD.id, views: {} });
    stopInfo = startServerInfo();
    page = mount();
    await page.renderApp();
    await until(() => composer() !== null && useServers.getState().byEndpoint[MACHINE] !== undefined);
}

function composer(): EditorView | null {
    const content = page.host.querySelector(`[data-split-cell][data-view-id="${LEAD.id}"] .cm-content`);
    return content === null ? null : EditorView.findFromDOM(content as HTMLElement);
}

async function type(words: string): Promise<void> {
    await act(async () => {
        const view = composer()!;
        view.dispatch(view.state.replaceSelection(words), { userEvent: 'input.type' });
    });
}

function options(): Element[] {
    return [...page.host.querySelectorAll('[role="option"]')];
}

function option(name: string): Element | null {
    return options().find((candidate) => candidate.textContent?.startsWith(name)) ?? null;
}

describe('a # in the composer', () => {
    test('offers the drawing, puts it in the text as a chip and sends its id', async () => {
        await open(true);
        await type('Draw a sun in #Sch');
        await until(() => option('Schets') !== null);
        expect(option('Schets')?.textContent).toBe('Schetsdrawing');
        await clickOn(option('Schets'));
        expect(composer()!.state.doc.toString()).toBe('Draw a sun in #Schets ');
        const chip = [...page.host.querySelectorAll('.cm-content span')].find((span) => span.className.includes('bg-text/8'));
        expect(chip?.textContent).toBe('Schets');
        await pressKey(composer()!.contentDOM, 'Enter');
        await until(() => machine.requests('chat.send').length === 1);
        expect(machine.requests('chat.send')[0]).toMatchObject({ chatId: LEAD.id, text: 'Draw a sun in #Schets', references: [SKETCH.id], chats: [] });
    });

    test('on a machine from before references offers chats only, and sends them as chats', async () => {
        await open(false);
        await type('#Sch');
        expect(options()).toEqual([]);
        await act(async () => composer()!.dispatch({ changes: { from: 0, to: composer()!.state.doc.length } }));
        await type('Ask #Pla');
        await until(() => option('Planner') !== null);
        await clickOn(option('Planner'));
        await pressKey(composer()!.contentDOM, 'Enter');
        await until(() => machine.requests('chat.send').length === 1);
        const sent = machine.requests('chat.send')[0]!;
        expect(sent).toMatchObject({ text: 'Ask #Planner', chats: [PLANNER.id] });
        expect(sent.references).toBeUndefined();
    });
});
