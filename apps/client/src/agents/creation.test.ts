import { describe, expect, test } from 'bun:test';
import type { ProviderInfo } from '@ruimte/contracts';
import { availableAgents, separatesFrontier } from './creation';

const provider = (kind: string, name: string, installed = true): ProviderInfo =>
    ({ kind, name, installed, capabilities: { chat: true, terminal: kind !== 'apple' } }) as ProviderInfo;

describe('availableAgents', () => {
    test('offers the frontier labs first and then the rest, each by name, whatever order the machine sent', () => {
        const providers = [
            provider('grok', 'Grok'),
            provider('claude', 'Claude Code'),
            provider('nanogpt', 'NanoGPT Subscription'),
            provider('codex', 'Codex'),
            provider('copilot', 'GitHub Copilot'),
            provider('anthropic-claude-api', 'Claude API'),
            provider('antigravity', 'Antigravity'),
            provider('kimi', 'Kimi', false)
        ];
        const names = availableAgents(providers, 'chat').map((entry) => entry.name);
        expect(names).toEqual(['Claude API', 'Claude Code', 'Codex', 'Antigravity', 'GitHub Copilot', 'Grok', 'NanoGPT Subscription']);
    });
});

describe('separatesFrontier', () => {
    test('only between the last frontier lab and the first other provider', () => {
        expect(separatesFrontier('codex', 'antigravity')).toBe(true);
        expect(separatesFrontier('claude', 'codex')).toBe(false);
        expect(separatesFrontier('antigravity', 'grok')).toBe(false);
        expect(separatesFrontier(undefined, 'grok')).toBe(false);
    });
});
