import { describe, expect, test } from 'bun:test';
import { hasHooks } from '../agents/hooks.ts';
import { BUILT_IN_KINDS } from './kinds.ts';
import { ProviderRegistry, providerFor } from './registry.ts';

describe('ProviderRegistry', () => {
    test('lists CLIs and the disabled local model with their capabilities', async () => {
        const registry = new ProviderRegistry({ detect: async () => ({ installed: true, version: '1.2.3' }) });
        const providers = await registry.list();
        expect(providers.map((provider) => provider.kind)).toEqual([...BUILT_IN_KINDS]);
        expect(providers.map((provider) => provider.name)).toEqual([
            'Claude Code',
            'Codex',
            'Antigravity',
            'GitHub Copilot',
            'Grok',
            'Apple Foundation Models'
        ]);
        expect(providers.map((provider) => provider.capabilities.chat)).toEqual([true, true, false, true, true, true]);
        expect(providers.map((provider) => provider.capabilities.terminal)).toEqual([true, true, true, true, true, false]);
        for (const provider of providers) {
            expect(provider.capabilities.hooks).toBe(hasHooks(provider.kind));
        }
    });

    test('a terminal-only CLI reports no models and detection still answers for it', async () => {
        const registry = new ProviderRegistry({ detect: async (command) => ({ installed: command === 'agy', version: null }) });
        const providers = await registry.list();
        const antigravity = providers.find((provider) => provider.kind === 'antigravity');
        expect(antigravity).toMatchObject({ installed: true, models: [], defaultModel: null, resumeCommand: 'agy {flags} --conversation {id}' });
        expect(antigravity?.capabilities).toMatchObject({ chat: false, terminal: true, hooks: false });
        expect(providers.find((provider) => provider.kind === 'copilot')?.installed).toBe(false);
    });

    test('a kind this daemon does not offer gets a provider that starts nothing, never another CLI', async () => {
        const provider = providerFor('future-cli');
        expect(provider.kind).toBe('future-cli');
        expect(provider.capabilities.chat).toBe(false);
        expect(provider.capabilities.terminal).toBe(false);
        expect(await new ProviderRegistry({ detect: async () => ({ installed: true, version: null }) }).list()).not.toContainEqual(
            expect.objectContaining({ kind: 'future-cli' })
        );
    });
});
