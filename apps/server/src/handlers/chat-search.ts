import { translate, type Dispatcher } from '../dispatcher.ts';
import type { ExternalChatSessions } from '../chat/external.ts';
import type { ProjectChatSearch } from '../chat/project-search.ts';

export function registerChatSearchHandlers(dispatcher: Dispatcher, search: ProjectChatSearch, external: ExternalChatSessions): void {
    dispatcher.register('chat.search', (payload, client) => translate(() => search.search(payload, client.id)));
    dispatcher.register('chat.searchCancel', (payload) => {
        search.cancel(payload.searchId);
        return {};
    });
    dispatcher.register('chat.external', (payload, client) => translate(() => external.list(payload.projectId, client.id)));
}
