import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { EditorView } from '@codemirror/view';
import type { ChatInfo, ProviderInfo } from '@ruimte/contracts';
import { useDocument } from '@/state/document';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { clickOn, mount, pressKey, until, type Mounted } from '../../testing/dom';

const CLAUDE = {
    kind: 'claude',
    name: 'Claude Code',
    installed: true,
    version: '2.1.0',
    models: [{ slug: 'model', name: 'Model', legacy: false, isDefault: true, options: [] }],
    defaultModel: 'model',
    capabilities: {
        chat: true,
        terminal: true,
        hooks: true,
        streamsToolOutput: false,
        diffs: 'before-after',
        attachments: true,
        mentions: true,
        denyReason: true,
        allowAlways: true,
        asyncQuestions: false,
        compaction: 'none',
        reportsCost: false,
        reportsContextWindow: false,
        reportsThinking: false,
        slashCommands: true,
        steer: false
    },
    resumeCommand: 'claude --resume {id}'
} as unknown as ProviderInfo;

function infoOf(chatId: string, patch: Partial<ChatInfo> = {}): ChatInfo {
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
        background: [],
        ...patch
    } as unknown as ChatInfo;
}

// Two chat views per test, named apart from the last test's, so no draft or row of one test is in the next.
let views = 0;
let first: string;
let second: string;

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;
let seq = 0;

/* The composer of a view on screen, or null while its chat has not opened. */
function composer(viewId: string): EditorView | null {
    const content = page.host.querySelector(`[data-split-cell][data-view-id="${viewId}"] .cm-content`);
    return content === null ? null : EditorView.findFromDOM(content as HTMLElement);
}

function text(viewId: string): string {
    return composer(viewId)!.state.doc.toString();
}

/* What the editor gets when a person types, without the layout a browser would measure first. */
async function type(viewId: string, words: string): Promise<void> {
    await act(async () => {
        const view = composer(viewId)!;
        view.dispatch(view.state.replaceSelection(words), { userEvent: 'input.type' });
    });
}

function button(label: string): Element | null {
    return page.host.querySelector(`[aria-label="${label}"]`);
}

/* Puts a view in front of the window's one cell, the way picking its tab does. */
async function showView(viewId: string): Promise<void> {
    await act(async () => useDocument.getState().setActiveView(viewId));
    await until(() => composer(viewId) !== null);
}

/* What the machine says about a chat as it changes, the way its stream does. */
function tell(chatId: string, patch: Partial<ChatInfo>): void {
    seq += 1;
    act(() => machine.emit('chat.event', { chatId, event: { type: 'info', info: infoOf(chatId, patch) }, seq }));
}

beforeEach(async () => {
    views += 2;
    first = `chat-${views - 1}`;
    second = `chat-${views}`;
    machine = new FakeMachine();
    machine.answer('provider.list', () => ({ providers: [CLAUDE] }));
    machine.answer('chat.attach', ({ chatId }) => ({ info: infoOf(chatId), items: [], seq }) as never);
    machine.answer('chat.send', () => ({ queued: false, turnId: 'turn-1' }));
    const chats = [
        { kind: 'chat', id: first, name: 'First', node: { provider: 'claude' } },
        { kind: 'chat', id: second, name: 'Second', node: { provider: 'claude' } }
    ];
    workspace = await openFakeWorkspace(machine, { views: chats } as never, { activeViewId: first, views: {} });
    page = mount();
    await page.renderApp();
    await until(() => composer(first) !== null);
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
});

describe('a chat view', () => {
    test('Enter sends what was typed to the machine and empties the box', async () => {
        await type(first, 'Look at the failing test');
        await pressKey(composer(first)!.contentDOM, 'Enter');
        await until(() => machine.requests('chat.send').length === 1);
        expect(machine.requests('chat.send')[0]).toMatchObject({ chatId: first, text: 'Look at the failing test', delivery: 'queue' });
        expect(text(first)).toBe('');
    });

    test('a message typed during a turn waits in the queue, and Send now sends it ahead', async () => {
        machine.answer('chat.send', () => ({ queued: true }));
        tell(first, { status: 'running', running: true, activeTurnId: 'turn-1' });
        await type(first, 'Also check the docs');
        await clickOn(button('Queue'));
        await until(() => machine.requests('chat.send').length === 1);
        expect(machine.requests('chat.send')[0]).toMatchObject({ chatId: first, text: 'Also check the docs', delivery: 'queue' });
        tell(first, { status: 'running', running: true, activeTurnId: 'turn-1', queue: [{ id: 'queued-1', text: 'Also check the docs', createdAt: 1 }] });
        await until(() => button('Send now') !== null);
        await clickOn(button('Send now'));
        await until(() => machine.requests('chat.sendNow').length === 1);
        expect(machine.requests('chat.sendNow')[0]).toMatchObject({ chatId: first, messageId: 'queued-1' });
    });

    test('Stop ends the running turn on the machine', async () => {
        tell(first, { status: 'running', running: true, activeTurnId: 'turn-1' });
        await clickOn(button('Stop, Shift-click to also stop its sub-agents'));
        await until(() => machine.requests('chat.cancel').length === 1);
        expect(machine.requests('chat.cancel')[0]).toEqual({ chatId: first });
    });

    test('a draft stays in its chat while another view is on screen, and goes nowhere', async () => {
        await type(first, 'Half a thought');
        await showView(second);
        expect(text(second)).toBe('');
        await showView(first);
        expect(text(first)).toBe('Half a thought');
        expect(machine.requests('chat.send')).toEqual([]);
    });
});
