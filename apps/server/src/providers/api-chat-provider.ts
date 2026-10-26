import type { ChatProvider } from '@adecore/agents/providers';

interface ApiService {
    readonly catalog: ChatProvider['catalog'];
    status(): { configured: boolean; models: number };
    onChange(listener: () => void): () => void;
}

interface ApiChatProviderOptions {
    readonly kind: string;
    readonly name: string;
    /* What the list draws beside the name once the provider is set up. */
    readonly version: string;
    readonly service: ApiService;
    readonly createBackend: ChatProvider['createBackend'];
}

/*
 * A provider with no CLI: the daemon talks to the API itself, so the provider is there once a person
 * saved a key in Settings and the API listed the models it offers.
 */
export function createApiChatProvider({ kind, name, version, service, createBackend }: ApiChatProviderOptions): ChatProvider {
    return {
        kind,
        name,
        command: [kind],
        resumeCommand: '',
        catalog: service.catalog,
        ignoresProjectConfig: true,
        capabilities: {
            chat: true,
            terminal: false,
            hooks: false,
            streamsToolOutput: false,
            diffs: 'unified',
            attachments: false,
            mentions: false,
            denyReason: true,
            allowAlways: false,
            asyncQuestions: false,
            compaction: 'none',
            reportsCost: false,
            reportsContextWindow: true,
            reportsThinking: true,
            slashCommands: false
        },
        detect: async () => {
            const { configured, models } = service.status();
            const ready = configured && models > 0;
            return { installed: ready, version: ready ? version : null };
        },
        firstPromptArgs: () => {
            throw new Error(`${name} is only available as a chat.`);
        },
        onChange: (listener) => service.onChange(listener),
        createBackend
    };
}
