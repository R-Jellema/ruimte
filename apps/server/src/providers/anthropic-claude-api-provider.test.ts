import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAnthropicClaudeApiProvider } from './anthropic-claude-api-provider.ts';
import { AnthropicClaudeApiService } from './anthropic-claude-api-service.ts';
import { ProviderRegistry } from './registry.ts';

const homes: string[] = [];
afterEach(async () => {
    await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

test('saving, refreshing and removing a Claude API key update the provider offered to other clients', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ruimte-claude-provider-'));
    homes.push(home);
    let model = 'claude-sonnet-example';
    const service = new AnthropicClaudeApiService(async () => Response.json({ data: [{ id: model, display_name: model, line: 'sonnet' }] }));
    await service.load(home);
    const provider = createAnthropicClaudeApiProvider(service);
    const registry = new ProviderRegistry({ providers: [provider] });
    service.onChange(() => registry.invalidate('anthropic-claude-api'));
    const changes: string[] = [];
    registry.onChange((kind) => changes.push(kind));

    expect(await registry.list()).toEqual([expect.objectContaining({ kind: 'anthropic-claude-api', installed: false })]);
    await service.configure('sk-ant-test-only');
    expect((await registry.list())[0]).toMatchObject({ installed: true, defaultModel: model });

    model = 'claude-sonnet-updated';
    await service.configure();
    expect((await registry.list())[0]?.models.map((entry) => entry.slug)).toEqual([model]);

    await service.configure('');
    expect((await registry.list())[0]).toMatchObject({ installed: false, models: [] });
    expect(changes).toEqual(['anthropic-claude-api', 'anthropic-claude-api', 'anthropic-claude-api']);
    expect(provider.capabilities.terminal).toBe(false);
});
