import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { ProjectCanvasView } from '@ruimte/contracts';
import { useUi } from '@/state/ui';
import { FakeMachine } from '../../testing/fake-machine';
import { fakeProvider } from '../../testing/fake-provider';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { mount, until, type Mounted } from '../../testing/dom';

const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [], texts: [], edges: [], layouts: [] };

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

beforeEach(async () => {
    machine = new FakeMachine();
    machine.answer('provider.list', () => ({ providers: [fakeProvider('claude', 'Claude Code'), fakeProvider('grok', 'Grok')] }));
    machine.answer('accounts.list', () => ({
        accounts: { claude: { kind: 'claude' }, grok: { kind: 'grok' } },
        statuses: [],
        loginCommands: { claude: 'claude /login', grok: 'grok login' },
        silentLogins: ['grok']
    }));
    // The terminal is not under test; a login that never starts keeps it quiet.
    machine.answer('session.login', () => new Promise(() => undefined));
    workspace = await openFakeWorkspace(machine, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    page = mount();
    await page.renderApp();
});

afterEach(async () => {
    act(() => useUi.getState().setLogin(null));
    await page.unmount();
    workspace.close();
});

function dialogText(): string {
    return document.querySelector('[role="dialog"]')?.textContent ?? '';
}

async function openLogin(kind: 'claude' | 'grok', name: string, sentence: string): Promise<string> {
    act(() => useUi.getState().setLogin({ endpointId: 'fake-machine', kind, accountId: kind, name }));
    await until(() => dialogText().includes(sentence));
    return dialogText();
}

describe('the login dialog', () => {
    test('says it closes by itself for a CLI the machine can ask about its login', async () => {
        const text = await openLogin('claude', 'Claude Code', 'This closes once you are logged in.');
        expect(text).not.toContain('Close this once');
    });

    test('asks a person to close it for a CLI whose login cannot report back', async () => {
        const text = await openLogin('grok', 'Grok', 'Close this once you are logged in.');
        expect(text).not.toContain('This closes once');
    });
});
