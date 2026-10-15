import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { ChatInfo, ProjectCanvasView, ProjectNode, ProviderInfo } from '@ruimte/contracts';
import { windowWorkspace } from '@/state/window';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { clickOn, mount, openSubmenu, until, type Mounted } from '../../testing/dom';

const CLAUDE = {
    kind: 'claude',
    name: 'Claude Code',
    installed: true,
    version: '2.1.0',
    models: [{ slug: 'model', name: 'Model', legacy: false, isDefault: true, options: [] }],
    defaultModel: 'model',
    capabilities: { chat: true, terminal: true },
    resumeCommand: 'claude --resume {id}'
} as unknown as ProviderInfo;

const CHAT: ProjectNode = { id: 'fresh-chat', kind: 'chat', provider: 'claude', x: 0, y: 0, w: 480, h: 520 } as ProjectNode;
const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [CHAT], texts: [], edges: [], layouts: [] };

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function infoOf(chatId: string): ChatInfo {
    return {
        chatId,
        provider: 'claude',
        cwd: '/work/atlas',
        agentSessionId: null,
        model: null,
        selection: { model: 'model', options: {} },
        runtimeMode: 'supervised',
        status: 'idle',
        running: false,
        activeTurnId: null,
        slashCommands: [],
        usage: { turns: 0, contextTokens: 0, contextWindow: 200_000, costUsd: 0 },
        background: []
    } as unknown as ChatInfo;
}

async function openNodeMenu(id: string): Promise<void> {
    const frame = page.host.querySelector(`[data-node-id="${id}"]`)!;
    await act(async () => {
        frame.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40, button: 2 }));
    });
    await until(() => document.querySelector('[role="menu"]') !== null);
}

function menuItem(text: string): HTMLElement | null {
    return ([...document.querySelectorAll('[role="menu"] [role^="menuitem"]')] as HTMLElement[]).find((item) => item.textContent?.includes(text)) ?? null;
}

function savedChat(): ProjectNode | undefined {
    const view = machine
        .requests('project.save')
        .at(-1)
        ?.content.views.find((candidate) => candidate.id === MAIN.id);
    return view?.kind === 'canvas' ? view.nodes?.find((node) => node.id === CHAT.id) : undefined;
}

beforeEach(async () => {
    machine = new FakeMachine();
    machine.answer('project.save', ({ baseRev }) => ({ rev: baseRev + 1 }) as never);
    machine.answer('provider.list', () => ({ providers: [CLAUDE] }));
    machine.answer('chat.attach', ({ chatId }) => ({ info: infoOf(chatId), items: [], seq: 0 }) as never);
    workspace = await openFakeWorkspace(machine, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    page = mount();
    await page.renderApp();
    await until(() => page.host.querySelector(`[data-node-id="${CHAT.id}"]`) !== null);
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
});

describe('the menu of a chat node', () => {
    test('a chat that has not run a turn offers no Conversation submenu', async () => {
        await openNodeMenu(CHAT.id);

        expect(menuItem('Rename')).not.toBeNull();
        expect(menuItem('Conversation')).toBeNull();
    });

    test('Color lists the accents by name, like Flag, and picking one saves it on the node', async () => {
        await openNodeMenu(CHAT.id);
        await openSubmenu('Color');

        expect(menuItem('Teal')).not.toBeNull();
        expect(menuItem('None')).not.toBeNull();

        await clickOn(menuItem('Teal'));
        await act(async () => windowWorkspace()!.connection.projects.flush());
        expect(savedChat()?.accent).toBe('teal');
    });
});
