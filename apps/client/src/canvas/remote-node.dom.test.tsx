import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { ChatInfo, ChatItem, ProjectCanvasView, ProjectNode, ProviderInfo } from '@ruimte/contracts';
import { PROMPT_SAMPLES } from '@adecore/agents-react/testing';
import { LOCAL_ENDPOINT_ID, useEndpoints } from '@/state/endpoints';
import { groupAttention, useAttention } from '@/state/attention';
import { projectNodes } from '@/project/view-nodes';
import { useChats } from '@adecore/agents-react/state';
import { useSessions } from '@/state/sessions';
import { useSnoozes } from '@/state/snooze';
import { windowWorkspace } from '@/state/window';
import { connectFakeMachine, FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';

const REMOTE = 'machine-b';
const LOCAL_SHELL: ProjectNode = { id: 'local-shell', kind: 'terminal', title: 'Shell here', x: 0, y: 0, w: 560, h: 360 };
const REMOTE_SHELL: ProjectNode = { id: 'remote-shell', kind: 'terminal', title: 'Shell there', x: 600, y: 0, w: 560, h: 360, machine: REMOTE };
const REMOTE_CHAT: ProjectNode = { id: 'remote-chat', kind: 'chat', title: 'Chat there', x: 0, y: 400, w: 560, h: 480, machine: REMOTE, provider: 'claude' };
const MAIN: ProjectCanvasView = {
    kind: 'canvas',
    id: 'main',
    name: 'Main',
    nodes: [LOCAL_SHELL, REMOTE_SHELL, REMOTE_CHAT],
    texts: [],
    edges: [],
    layouts: []
};

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

const APPROVAL = PROMPT_SAMPLES.find((sample) => sample.label === 'Permission · Command')!.items[0]! as ChatItem;

let here: FakeMachine;
let there: FakeMachine;
let workspace: FakeWorkspace;
let disconnectThere: () => void;
let page: Mounted;
let seq = 0;

/* What the machine the chat runs on says about it, the way its stream does. */
async function tellFromThere(patch: Partial<ChatInfo>, items: ChatItem[] = []): Promise<void> {
    await act(async () => {
        for (const item of items) {
            seq += 1;
            there.emit('chat.event', { chatId: REMOTE_CHAT.id, event: { type: 'item', item }, seq });
        }
        seq += 1;
        there.emit('chat.event', { chatId: REMOTE_CHAT.id, event: { type: 'info', info: infoOf(REMOTE_CHAT.id, patch) }, seq });
    });
}

beforeEach(async () => {
    here = new FakeMachine();
    here.answer('project.save', ({ baseRev }) => ({ rev: baseRev + 1 }) as never);
    there = new FakeMachine();
    there.answer('provider.list', () => ({ providers: [CLAUDE] }));
    there.answer('chat.attach', ({ chatId }) => ({ info: infoOf(chatId), items: [], seq }) as never);
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
    page = mount();
    await page.renderApp();
    await until(() => page.host.querySelector(`[data-node-id="${REMOTE_SHELL.id}"] textarea`) !== null);
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
    disconnectThere();
    useEndpoints.getState().setActive(LOCAL_ENDPOINT_ID);
    useEndpoints.getState().remove(REMOTE);
});

describe('a node that runs on another machine', () => {
    test('a terminal attaches over the link of its own machine, and the project machine hears nothing of it', async () => {
        await until(() => there.requests('session.attach').some((request) => request.sessionId === REMOTE_SHELL.id));
        await until(() => here.requests('session.attach').some((request) => request.sessionId === LOCAL_SHELL.id));
        const aboutIt = (machine: FakeMachine): string[] =>
            machine.sent
                .filter((request) => request.type.startsWith('session.') && JSON.stringify(request.payload).includes(REMOTE_SHELL.id))
                .map((request) => request.type);
        expect(aboutIt(here)).toEqual([]);
        expect(there.requests('session.attach').map((request) => request.sessionId)).toEqual([REMOTE_SHELL.id]);
    });

    test('a permission card of its chat is answered over the machine the chat runs on', async () => {
        await until(() => there.requests('chat.attach').length > 0);
        await tellFromThere({ status: 'needs-you' }, [APPROVAL]);
        await until(() => page.host.querySelector('[data-prompt-stack]') !== null || document.querySelector('button') !== null);
        const allow = (): HTMLElement | null =>
            ([...page.host.querySelectorAll('button')] as HTMLElement[]).find((button) => /^Allow\b/.test(button.textContent?.trim() ?? '')) ?? null;
        await until(() => allow() !== null);
        await clickOn(allow());
        await until(() => there.requests('chat.approve').length === 1);
        expect(there.requests('chat.approve')[0]).toMatchObject({ chatId: REMOTE_CHAT.id, requestId: (APPROVAL as { requestId: string }).requestId });
        expect(here.requests('chat.approve')).toEqual([]);
    });

    test('a chat of its machine waiting on a person counts once', async () => {
        await until(() => there.requests('chat.attach').length > 0);
        await tellFromThere({ status: 'needs-you' }, [APPROVAL]);
        await until(() => useChats.getState().statusByKey[`${REMOTE}:${REMOTE_CHAT.id}`]?.info.status === 'needs-you');
        const groups = groupAttention(
            projectNodes(),
            useSessions.getState().byKey,
            useChats.getState().statusByKey,
            windowWorkspace()!.connection.endpointId,
            useAttention.getState().unseen,
            useSnoozes.getState().byKey
        );
        expect(groups.needsYou).toEqual([REMOTE_CHAT.id]);
    });
});
