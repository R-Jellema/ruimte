import type { Dispatcher } from '../dispatcher.ts';
import type { SecretService } from '../secrets/secret-service.ts';

/* Every client of the machine is its owner or one the owner let in, so any of them answers a card, as a question of a chat is answered. */
export function registerSecretHandlers(dispatcher: Dispatcher, secrets: SecretService): void {
    dispatcher.register('secret.requests', () => ({ requests: secrets.list() }));

    dispatcher.register('secret.save', async (payload) => ({ accepted: await secrets.save(payload.requestId, payload.value) }));

    dispatcher.register('secret.decline', (payload) => ({ accepted: secrets.decline(payload.requestId) }));
}
