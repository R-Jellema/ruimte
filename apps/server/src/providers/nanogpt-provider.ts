import { NanoGptBackend } from '../chat/nanogpt-backend.ts';
import { createApiChatProvider } from './api-chat-provider.ts';
import { NanoGptService } from './nanogpt-service.ts';

/* One per daemon, like the Claude API provider (`anthropic-claude-api-provider.ts`). */
export const nanoGptService = new NanoGptService();
export const nanoGptProvider = createApiChatProvider({
    kind: 'nanogpt',
    name: 'NanoGPT',
    version: 'Subscription',
    service: nanoGptService,
    createBackend: (launch, host) => new NanoGptBackend(launch, host, nanoGptService)
});
