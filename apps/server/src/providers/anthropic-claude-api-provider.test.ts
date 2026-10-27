import { expect, test } from 'bun:test';
import { createAnthropicClaudeApiProvider } from './anthropic-claude-api-provider.ts';
import { AnthropicClaudeApiService } from './anthropic-claude-api-service.ts';
import { ProviderRegistry } from './registry.ts';
import { tempHomes } from './test-helpers.ts';

const newHome = tempHomes('ruimte-claude-provider-');

test('saving, refreshing and removing a Claude API key update the provider offered to other clients', async () => {
    let model = 'claude-sonnet-example';
    const service = new AnthropicClaudeApiService(async () => Response.json({ data: [{ id: model, display_name: model, line: 'sonnet' }] }));
    await service.load(await newHome());
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
