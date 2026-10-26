import type { ChatProvider } from '@adecore/agents/providers';
import { AnthropicClaudeApiBackend } from '../chat/anthropic-claude-api-backend.ts';
import { createApiChatProvider } from './api-chat-provider.ts';
import { AnthropicClaudeApiService } from './anthropic-claude-api-service.ts';

export function createAnthropicClaudeApiProvider(service: AnthropicClaudeApiService): ChatProvider {
    return createApiChatProvider({
        kind: 'anthropic-claude-api',
        name: 'Claude API',
        version: 'API key',
        service,
        createBackend: (launch, host) => new AnthropicClaudeApiBackend(launch, host, service)
    });
}

/*
 * One per daemon, so the places without a registry at hand (`providerFor`) see the same name and models
 * as the registry. The daemon loads it from its home at boot.
 */
export const anthropicClaudeApiService = new AnthropicClaudeApiService();
export const anthropicClaudeApiProvider = createAnthropicClaudeApiProvider(anthropicClaudeApiService);
