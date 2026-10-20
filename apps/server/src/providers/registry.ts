import type { AgentKind, ProviderInfo } from '@ruimte/contracts';
import type { CliDetection, ChatProvider } from '@adecore/agents/providers';
import { ProviderRegistry as AgentProviderRegistry } from '@adecore/agents/providers';
import { createAppleProvider, appleProvider } from './apple-provider.ts';
import { claudeProvider } from './claude-provider.ts';
import { codexProvider } from './codex-provider.ts';
import { copilotProvider, grokProvider } from './acp-providers.ts';
import { geminiProvider } from './terminal-providers.ts';

// The CLIs the daemon ships with, in the order of `BUILT_IN_KINDS`. A new one is one more value in both.
const BUILT_IN_PROVIDERS: ChatProvider[] = [claudeProvider, codexProvider, geminiProvider, copilotProvider, grokProvider];

// Offers nothing, so it answers a kind this version does not know with a provider that starts nothing.
const UNOFFERED = new AgentProviderRegistry({ providers: [] });

/* The provider of a kind, for the places that have no registry at hand (the hooks). */
export function providerFor(kind: AgentKind): ChatProvider {
    return kind === 'apple' ? appleProvider : (BUILT_IN_PROVIDERS.find((provider) => provider.kind === kind) ?? UNOFFERED.get(kind));
}

interface ProviderRegistryOptions {
    providers?: ChatProvider[];
    appleEnabled?: () => boolean;
    // The executables to probe, when they are not the ones the providers name.
    commands?: Partial<Record<AgentKind, string>>;
    // How to probe; a test answers without spawning anything.
    detect?: (command: string) => Promise<CliDetection>;
    // Called on every `provider.list`, which is when a newer model catalog is worth asking for.
    onList?: () => void;
}

/* What the daemon knows about each agent CLI: the chat CLIs, the ones it only starts in a terminal and the local model. */
export class ProviderRegistry extends AgentProviderRegistry {
    private readonly onList: (() => void) | null;

    constructor(options: ProviderRegistryOptions = {}) {
        super({
            providers: options.providers ?? [...BUILT_IN_PROVIDERS, createAppleProvider(options.appleEnabled ?? (() => false))],
            ...(options.commands ? { commands: options.commands } : {}),
            ...(options.detect ? { detect: options.detect } : {})
        });
        this.onList = options.onList ?? null;
    }

    override list(): Promise<ProviderInfo[]> {
        this.onList?.();
        return super.list();
    }

    protected override fallback(kind: AgentKind): ChatProvider {
        return providerFor(kind);
    }
}
