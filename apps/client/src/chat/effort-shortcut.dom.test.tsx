import { afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { ProviderInfo } from '@ruimte/contracts';
import { isApplePlatform } from '@/desktop/bridge';
import { useDocument } from '@/state/document';
import { chatInfoOf } from '../../testing/chat-info';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { mount, until, type Mounted } from '../../testing/dom';

const CLAUDE = {
    kind: 'claude',
    name: 'Claude Code',
    installed: true,
    version: '2.1.0',
    models: [
        {
            slug: 'model',
            name: 'Model',
            legacy: false,
            isDefault: true,
            options: [
                {
                    id: 'effort',
                    label: 'Reasoning',
                    type: 'select',
                    defaultChoice: 'medium',
                    choices: [
                        { id: 'low', label: 'Low' },
                        { id: 'medium', label: 'Medium' },
                        { id: 'high', label: 'High' }
                    ]
                }
            ]
        }
    ],
    defaultModel: 'model',
    capabilities: { chat: true, terminal: true, hooks: true, diffs: 'before-after', slashCommands: true },
    resumeCommand: 'claude --resume {id}'
} as unknown as ProviderInfo;

const CHAT_ID = 'chat-effort';

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

afterEach(async () => {
    await page.unmount();
    workspace.close();
});

/* The key with Shift held, as the physical key a shortcut matches on. */
async function pressWithShift(key: '>' | '<', code: 'Period' | 'Comma'): Promise<void> {
    const apple = isApplePlatform();
    await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key, code, shiftKey: true, metaKey: apple, ctrlKey: !apple, bubbles: true, cancelable: true }));
    });
}

describe('the reasoning effort of the chat that has the keyboard', () => {
    test('steps one choice up and down from the keyboard, and the machine is told each step', async () => {
        machine = new FakeMachine();
        machine.answer('provider.list', () => ({ providers: [CLAUDE] }));
        machine.answer('chat.attach', ({ chatId }) => ({ info: chatInfoOf(chatId), items: [], seq: 0 }) as never);
        machine.answer('chat.configure', ({ chatId, selection }) => chatInfoOf(chatId, selection === undefined ? {} : { selection }) as never);
        const chat = { kind: 'chat', id: CHAT_ID, name: 'Agent', node: { provider: 'claude' } };
        workspace = await openFakeWorkspace(machine, { views: [chat] } as never, { activeViewId: CHAT_ID, views: {} });
        page = mount();
        await page.renderApp();
        await until(() => machine.requests('chat.attach').some((request) => request.chatId === CHAT_ID));
        await until(() => page.host.querySelector('.cm-content') !== null);
        await act(async () => useDocument.getState().setBodyFocused(true));

        await pressWithShift('>', 'Period');
        await until(() => machine.requests('chat.configure').length === 1);
        expect(machine.requests('chat.configure')[0]).toMatchObject({ chatId: CHAT_ID, selection: { model: 'model', options: { effort: 'high' } } });

        await pressWithShift('<', 'Comma');
        await until(() => machine.requests('chat.configure').length === 2);
        expect(machine.requests('chat.configure')[1]).toMatchObject({ chatId: CHAT_ID, selection: { model: 'model', options: { effort: 'medium' } } });
    });
});
