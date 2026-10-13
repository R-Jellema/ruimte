import type { EndpointIdentity } from '../endpoint-id.ts';
import { SharedWatch } from '../fs/shared-watch.ts';
import { FolderWatcher } from '../fs/watch.ts';
import { GitStatusWatcher } from '../git/status-watcher.ts';
import { worktreeAgents } from '../git/worktree-agents.ts';
import { WorktreeMerge } from '../git/worktree-merge.ts';
import { Worktrees } from '../git/worktrees.ts';
import type { AgentsBundle } from './agents.ts';
import type { AgentWorkBundle } from './agent-work.ts';

/* The folders of projects as files and as checkouts. */
export interface GitBundle {
    /* One platform watcher per folder for the file tree, git status and the language servers together. */
    watches: SharedWatch;
    folders: FolderWatcher;
    statuses: GitStatusWatcher;
    worktrees: Worktrees;
    merges: WorktreeMerge;
    /* The worktrees of the repository the folder is in; empty when it is not in one. */
    worktreePaths(folder: string): Promise<string[]>;
}

export function wireGit(home: string, identity: EndpointIdentity, agents: AgentsBundle, work: AgentWorkBundle): GitBundle {
    const watches = new SharedWatch();
    const folders = new FolderWatcher(process.platform, watches);
    const statuses = new GitStatusWatcher(process.platform, watches);
    const worktrees = new Worktrees(home, Date.now, () => identity.worktreeRoot);
    const agentsInWorktrees = worktreeAgents({
        chats: () => agents.chats.list(),
        sessions: () => agents.sessions.list(),
        stopNode: (nodeId, reason) => work.endChildren.stopNode(nodeId, reason)
    });
    worktrees.attachAgents(agentsInWorktrees);
    const merges = new WorktreeMerge(worktrees, agentsInWorktrees);
    const worktreePaths = (folder: string): Promise<string[]> =>
        worktrees
            .list(folder)
            .then((list) => list.map((worktree) => worktree.path))
            .catch(() => []);
    return { watches, folders, statuses, worktrees, merges, worktreePaths };
}
