import { createAcpBackend, type AcpClientInfo, type AcpModeMap } from '@adecore/agents/chat';
import { ModelCatalog, createAcpProvider, type AcpProviderSpec, type ChatProvider } from '@adecore/agents/providers';

// How the daemon names itself to every ACP agent it starts.
export const RUIMTE_ACP_CLIENT: AcpClientInfo = { name: 'ruimte', title: 'Ruimte', version: '0.1.0' };

// The model these CLIs pick themselves; the agent is then left its own choice instead of being told one.
export const AGENT_DEFAULT_MODEL = 'default';

function agentDefaultCatalog(): ModelCatalog {
    return new ModelCatalog({
        defaultModel: AGENT_DEFAULT_MODEL,
        profiles: { agent: { options: [], contextWindowTokens: {} } },
        models: [{ slug: AGENT_DEFAULT_MODEL, name: 'Default', profile: 'agent' }]
    });
}

function agentModel(selection: { model: string }): string | null {
    return selection.model === AGENT_DEFAULT_MODEL ? null : selection.model;
}

/*
 * Grok's session modes (`default`, `plan`, `ask`) choose what a turn does, not what it may do without
 * asking, so only `supervised` names one; every wider runtime mode runs in `default` and the backend
 * answers the permission requests that mode allows. Ids from xai-org/grok-build (`SessionMode`).
 */
export const GROK_MODES: AcpModeMap = { supervised: ['default'] };

/*
 * Copilot's ACP modes are agent, plan and autopilot; autopilot keeps a turn going but still asks for
 * every tool (github/copilot-cli#2942), so it is no permission level and `supervised` names the agent mode.
 */
export const COPILOT_MODES: AcpModeMap = { supervised: ['https://agentclientprotocol.com/protocol/session-modes#agent'] };

/* The login Grok is asked to use: the key in the environment where there is one, else the one `grok login` left. */
export function grokAuthMethod(env: Record<string, string | undefined>): string {
    return env.XAI_API_KEY ? 'xai.api_key' : 'cached_token';
}

const GROK_SPEC: AcpProviderSpec = {
    kind: 'grok',
    name: 'Grok',
    command: 'grok',
    // A chat must not wait on an update check; the flag belongs before the subcommand.
    args: ['--no-auto-update', 'agent', 'stdio'],
    catalog: agentDefaultCatalog(),
    model: agentModel,
    modes: GROK_MODES,
    loginHint: 'Run `grok login` in a terminal, or set `XAI_API_KEY`.',
    client: RUIMTE_ACP_CLIENT,
    capabilities: { terminal: true },
    resumeCommand: 'grok {flags} --resume {id}',
    home: { env: 'GROK_HOME', fallback: '.grok', loginEnv: ['XAI_API_KEY'], loginCommand: 'grok login' },
    firstPromptArgs: (prompt) => [prompt]
};

export const grokProvider: ChatProvider = {
    ...createAcpProvider(GROK_SPEC),
    createBackend: (launch, host) => createAcpBackend({ ...GROK_SPEC, authMethod: grokAuthMethod(launch.env) })(launch, host)
};

export const copilotProvider: ChatProvider = createAcpProvider({
    kind: 'copilot',
    name: 'GitHub Copilot',
    command: 'copilot',
    args: ['--acp', '--stdio', '--no-auto-update'],
    catalog: agentDefaultCatalog(),
    model: agentModel,
    modes: COPILOT_MODES,
    loginHint: 'Run `copilot login` in a terminal.',
    client: RUIMTE_ACP_CLIENT,
    capabilities: { terminal: true },
    resumeCommand: 'copilot {flags} --resume={id}',
    // `-p` answers and exits; `-i` runs the prompt and stays.
    firstPromptArgs: (prompt) => ['-i', prompt]
});
