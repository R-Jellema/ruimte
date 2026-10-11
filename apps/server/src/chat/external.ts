import { isCanvasView, isSessionView, type ChatExternalResult, type ChatExternalSession, type ProjectView } from '@ruimte/contracts';
import { listClaudeSessions, listCodexSessions, type ExternalSession, type SessionFs } from '@adecore/agents/chat/external-sessions';
import type { UsageRootPath } from '@adecore/agents/usage/roots';

import { ChatSearchError } from './project-search.ts';

export interface ExternalChatSessionsDeps {
    /* Whether this client has the project open. */
    holds(clientId: string, projectId: string): Promise<boolean>;
    folderOf(projectId: string): string | null;
    /* Where each CLI keeps its transcripts, per account folder. */
    roots(): UsageRootPath[];
    /* The CLI sessions the project's own chats, terminals and nodes already run. */
    ownSessionIds(projectId: string): Promise<ReadonlySet<string>>;
    fs: SessionFs;
}

/* The agent sessions the nodes and views of a project resume, which are Ruimte's own however they began. */
export function resumesOfViews(views: readonly ProjectView[]): string[] {
    return views.flatMap((view): string[] => {
        if (isSessionView(view)) {
            return 'node' in view && view.node.resume !== undefined ? [view.node.resume] : [];
        }
        return isCanvasView(view) ? view.nodes.flatMap((node) => (node.resume === undefined ? [] : [node.resume])) : [];
    });
}

/*
 * Claude and Codex sessions that were started in a project's folder outside Ruimte, read from the
 * transcript folders of every account and nowhere else. Sessions Ruimte runs itself are left out.
 */
export class ExternalChatSessions {
    private readonly deps: ExternalChatSessionsDeps;

    constructor(deps: ExternalChatSessionsDeps) {
        this.deps = deps;
    }

    async list(projectId: string, clientId: string): Promise<ChatExternalResult> {
        if (!(await this.deps.holds(clientId, projectId))) {
            throw new ChatSearchError('not-open', 'Open this project before listing its sessions');
        }
        const folder = this.deps.folderOf(projectId);
        if (folder === null) {
            return { sessions: [], failed: [] };
        }
        const own = await this.deps.ownSessionIds(projectId);
        const sessions: ChatExternalSession[] = [];
        const failed: ChatExternalResult['failed'] = [];
        for (const root of this.deps.roots()) {
            try {
                const found: ExternalSession[] =
                    root.provider === 'claude'
                        ? await listClaudeSessions({ projectsDir: root.path, folder, fs: this.deps.fs })
                        : await listCodexSessions({ sessionsDir: root.path, folder, fs: this.deps.fs });
                // A default account is the one a chat starts with when it names none.
                const account = root.accounts?.find((id) => id !== root.provider) ?? undefined;
                for (const session of found) {
                    if (
                        !own.has(session.sessionId) &&
                        !sessions.some((known) => known.provider === session.provider && known.sessionId === session.sessionId)
                    ) {
                        sessions.push({ ...session, ...(account === undefined ? {} : { account }) });
                    }
                }
            } catch (e) {
                failed.push({ provider: root.provider, reason: e instanceof Error ? e.message : String(e) });
            }
        }
        return { sessions: sessions.sort((left, right) => right.updatedAt - left.updatedAt), failed };
    }
}
