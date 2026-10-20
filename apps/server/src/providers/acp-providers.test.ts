import { describe, expect, test } from 'bun:test';
import type { BackendEvent, BackendLaunch } from '@adecore/agents/chat';
import type { ChatProvider } from '@adecore/agents/providers';
import { fakeAcpWith, inProcess, type FakeAcpOptions } from '@adecore/agents/testing';
import { AGENT_DEFAULT_MODEL, COPILOT_MODES, GROK_MODES, copilotProvider, grokAuthMethod, grokProvider } from './acp-providers.ts';

const GROK_SESSION_MODES = ['default', 'plan', 'ask'];

/* A chat backend of the provider on the fake ACP agent, the events it raised and the arguments it started with. */
function run(provider: ChatProvider, options: FakeAcpOptions, overrides: Partial<BackendLaunch> = {}) {
    const events: BackendEvent[] = [];
    const methods: string[] = [];
    let onTurnDone: () => void = () => undefined;
    const turnDone = new Promise<void>((resolve) => {
        onTurnDone = resolve;
    });
    const fake = inProcess((io) => {
        const program = fakeAcpWith(options)(io);
        return {
            onLine: (line) => {
                const frame = JSON.parse(line) as { method?: string };
                if (frame.method) {
                    methods.push(frame.method);
                }
                program.onLine(line);
            }
        };
    });
    const backend = provider.createBackend(
        {
            command: provider.command,
            cwd: '/tmp',
            env: {},
            selection: provider.catalog.normalize(undefined),
            modelName: provider.catalog.nameOf(provider.catalog.defaultModel),
            runtimeMode: 'supervised',
            resume: null,
            generation: 1,
            instructions: null,
            resumeNote: null,
            spawn: fake.spawn,
            ...overrides
        },
        {
            onEvent: (event) => {
                events.push(event);
                if (event.type === 'turn.done') {
                    onTurnDone();
                }
            }
        }
    );
    return { backend, events, methods, fake, turnDone };
}

describe('Grok', () => {
    test('runs as an ACP agent over stdio, without an update check, and as a terminal', () => {
        expect(grokProvider.kind).toBe('grok');
        expect(grokProvider.command).toEqual(['grok', '--no-auto-update', 'agent', 'stdio']);
        expect(grokProvider.capabilities.chat).toBe(true);
        expect(grokProvider.capabilities.terminal).toBe(true);
        expect(grokProvider.home).toEqual({ env: 'GROK_HOME', fallback: '.grok', loginEnv: ['XAI_API_KEY'], loginCommand: 'grok login' });
        expect(grokProvider.firstPromptArgs('fix it')).toEqual(['fix it']);
    });

    test('only supervised names a session mode, since Grok has no mode that widens what it may do', () => {
        expect(GROK_MODES).toEqual({ supervised: ['default'] });
    });

    test('signs in with the key in the environment where there is one, else with the stored login', () => {
        expect(grokAuthMethod({ XAI_API_KEY: 'key' })).toBe('xai.api_key');
        expect(grokAuthMethod({})).toBe('cached_token');
    });

    test('a turn goes through and back, signed in with the stored login and left on its own model', async () => {
        const { backend, events, methods, fake, turnDone } = run(grokProvider, { authMethod: 'cached_token', modes: GROK_SESSION_MODES });
        await backend.start();
        expect(fake.started[0]?.argv).toEqual(['--no-auto-update', 'agent', 'stdio']);
        expect(methods).toEqual(['initialize', 'session/new', 'authenticate', 'session/new']);
        backend.sendTurn({ promptId: 'p1', text: 'hello', preamble: null, attachments: [], mentions: [], skills: [] });
        await turnDone;
        const text = events.flatMap((event) => (event.type === 'text.done' ? [event.text] : [])).join('');
        expect(text).toBe('echo: hello');
        expect(events).toContainEqual(expect.objectContaining({ type: 'turn.done', promptId: 'p1', state: 'done' }));
        expect(methods).not.toContain('session/set_model');
        await backend.dispose();
    });

    test('a full-access chat stays in the default session mode', async () => {
        const { backend, methods } = run(grokProvider, { modes: GROK_SESSION_MODES }, { runtimeMode: 'full-access' });
        await backend.start();
        expect(methods).not.toContain('session/set_mode');
        await backend.dispose();
    });
});

describe('Copilot', () => {
    test('runs its ACP server over stdio beside its terminal', () => {
        expect(copilotProvider.command).toEqual(['copilot', '--acp', '--stdio', '--no-auto-update']);
        expect(copilotProvider.capabilities.chat).toBe(true);
        expect(copilotProvider.capabilities.terminal).toBe(true);
        expect(copilotProvider.firstPromptArgs('go')).toEqual(['-i', 'go']);
        expect(copilotProvider.catalog.defaultModel).toBe(AGENT_DEFAULT_MODEL);
    });

    test('a supervised chat switches to the agent mode', async () => {
        const agentMode = COPILOT_MODES.supervised![0]!;
        const { backend, methods } = run(copilotProvider, { modes: ['https://agentclientprotocol.com/protocol/session-modes#autopilot', agentMode] });
        await backend.start();
        expect(methods).toContain('session/set_mode');
        await backend.dispose();
    });
});
