import { isCanvasView, type ChatItem, type ChatSearchHit, type ChatSearchPayload, type ChatSearchResult, type ProjectView } from '@ruimte/contracts';
import { CodedError } from '@adecore/agents/coded-error';
import { searchThreadItems } from '@adecore/agents/chat/thread-search';

export class ChatSearchError extends CodedError<'not-open'> {}

export interface SearchableChat {
    chatId: string;
    title: string;
}

export interface ProjectChatSearchDeps {
    /* Whether this client has the project open. */
    holds(clientId: string, projectId: string): Promise<boolean>;
    chatsOf(projectId: string): SearchableChat[];
    /* The thread of a chat the daemon runs now; null when no session of it is loaded. */
    loadedItems(chatId: string): readonly ChatItem[] | null;
    /* The thread as it is on disk, the log played over the snapshot; null when it cannot be read. */
    readStored(chatId: string): Promise<readonly ChatItem[] | null>;
}

const DEFAULT_LIMIT = 200;
const HITS_PER_CHAT = 20;

/* The chats a person can open in a project: chat views that are listed, and the chat nodes on its canvases. */
export function chatsOfViews(views: readonly ProjectView[]): SearchableChat[] {
    return views.flatMap((view): SearchableChat[] => {
        if (view.kind === 'chat') {
            return view.empty === true || view.hidden === true ? [] : [{ chatId: view.id, title: view.name ?? '' }];
        }
        if (isCanvasView(view)) {
            return view.nodes.filter((node) => node.kind === 'chat').map((node) => ({ chatId: node.id, title: node.title }));
        }
        return [];
    });
}

/*
 * Searches the messages of every chat in a project, one chat after the other, so a search over a
 * long history never holds more than one thread in memory and a newer query can stop it between two.
 */
export class ProjectChatSearch {
    private readonly deps: ProjectChatSearchDeps;
    private readonly running = new Set<string>();
    private readonly cancelled = new Set<string>();

    constructor(deps: ProjectChatSearchDeps) {
        this.deps = deps;
    }

    /* Stops the search before it opens its next chat; a search that is not running is nothing to stop. */
    cancel(searchId: string): void {
        if (this.running.has(searchId)) {
            this.cancelled.add(searchId);
        }
    }

    async search(payload: ChatSearchPayload, clientId: string): Promise<ChatSearchResult> {
        const { searchId, query, projectId } = payload;
        const limit = payload.limit ?? DEFAULT_LIMIT;
        this.running.add(searchId);
        try {
            if (!(await this.deps.holds(clientId, projectId))) {
                throw new ChatSearchError('not-open', 'Open this project before searching its chats');
            }
            const result: ChatSearchResult = { hits: [], chats: [], searched: 0, failed: [], truncated: false, cancelled: false };
            // The chats a session of the daemon holds now come first: they are the ones in use.
            const chats = this.deps.chatsOf(projectId);
            const ordered = [
                ...chats.filter((chat) => this.deps.loadedItems(chat.chatId) !== null),
                ...chats.filter((chat) => this.deps.loadedItems(chat.chatId) === null)
            ];
            for (const chat of ordered) {
                if (this.cancelled.has(searchId)) {
                    result.cancelled = true;
                    break;
                }
                if (result.hits.length >= limit) {
                    result.truncated = true;
                    break;
                }
                const items = this.deps.loadedItems(chat.chatId) ?? (await this.read(chat.chatId));
                if (items === null) {
                    result.failed.push({ chatId: chat.chatId, title: chat.title, reason: 'The chat could not be read' });
                    continue;
                }
                result.searched += 1;
                const room = Math.min(HITS_PER_CHAT, limit - result.hits.length);
                // One more than fits says that there were more.
                const all = searchThreadItems(items, query, { limit: room + 1 });
                const found = all.slice(0, room);
                result.truncated = result.truncated || all.length > room;
                if (found.length > 0) {
                    result.chats.push({ chatId: chat.chatId, title: chat.title });
                    result.hits.push(
                        ...found.map(({ itemId, author, snippet, matchStart, matchLength, createdAt }): ChatSearchHit => ({
                            chatId: chat.chatId,
                            itemId,
                            author,
                            snippet,
                            matchStart,
                            matchLength,
                            createdAt
                        }))
                    );
                }
            }
            return result;
        } finally {
            this.running.delete(searchId);
            this.cancelled.delete(searchId);
        }
    }

    private async read(chatId: string): Promise<readonly ChatItem[] | null> {
        try {
            return await this.deps.readStored(chatId);
        } catch {
            return null;
        }
    }
}
