import { afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { AgentServerStatus, ProviderInfo } from '@ruimte/contracts';
import { useUi } from '@/state/ui';
import { FakeMachine } from '../../../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../../../testing/fake-workspace';
import { clickOn, mount, until, type Mounted } from '../../../../testing/dom';

const ANTIGRAVITY: ProviderInfo = {
    kind: 'antigravity',
    name: 'Antigravity',
    installed: false,
    version: null,
    models: [],
    defaultModel: null,
    capabilities: {
        chat: true,
        terminal: true,
        hooks: true,
        streamsToolOutput: false,
        diffs: 'none',
        attachments: false,
        mentions: false,
        denyReason: false,
        allowAlways: true,
        asyncQuestions: false,
        compaction: 'none',
        reportsCost: false,
        reportsContextWindow: false,
        reportsThinking: false,
        slashCommands: false
    },
    resumeCommand: 'agy {flags} --conversation {id}',
    install: {
        description: "Google's coding agent, in a terminal and in a chat.",
        commands: { darwin: 'curl -fsSL https://antigravity.google/cli/install.sh | bash' },
        signIn: [{ kind: 'chat' }]
    }
};

const SERVER_MISSING: AgentServerStatus = { provider: 'antigravity', state: 'missing', version: '1.4.1', installed: null };

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function stepStates(): Record<string, string | undefined> {
    const steps = [...document.querySelectorAll<HTMLElement>('[role="dialog"] li[data-state]')];
    return Object.fromEntries(steps.map((step) => [step.querySelector('h4')?.textContent ?? '', step.dataset.state]));
}

async function openInstallPage(): Promise<void> {
    machine = new FakeMachine();
    machine.answer('provider.list', () => ({ providers: [ANTIGRAVITY] }));
    machine.answer('provider.server', () => ({ server: SERVER_MISSING }));
    workspace = await openFakeWorkspace(machine, { views: [] } as never, { activeViewId: null, views: {} });
    page = mount();
    await page.renderApp();
    await act(async () => useUi.getState().setSettings({ open: true, section: 'providers' }));
    const row = (): HTMLButtonElement | undefined =>
        [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((element) => element.textContent?.includes('Antigravity'));
    await until(() => row() !== undefined);
    await clickOn(row()!);
    await until(() => stepStates()['Install the CLI'] !== undefined);
}

afterEach(async () => {
    // The store outlives the page, and the next file would open on these settings.
    useUi.getState().setSettings({ open: false, section: 'appearance', target: null });
    await page.unmount();
    workspace.close();
});

describe('installing Antigravity in Settings, Providers', () => {
    test('the CLI is done once `agy` is found, and the chat server is the step after it', async () => {
        await openInstallPage();
        expect(stepStates()).toMatchObject({ 'Install the CLI': 'current', 'Install the chat server': 'later' });

        // What the machine reports once `agy` is there and its chat server is not yet.
        act(() =>
            machine.emit('provider.changed', {
                providers: [{ ...ANTIGRAVITY, installed: true, version: '1.4.0', capabilities: { ...ANTIGRAVITY.capabilities, chat: false } }]
            })
        );
        await until(() => stepStates()['Install the CLI'] === 'done');
        expect(stepStates()['Install the chat server']).toBe('current');
        expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Installed, version 1.4.0.');
    });
});
