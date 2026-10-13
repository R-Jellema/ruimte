import type { CheckoutHost } from '../canvas/verb.ts';
import type { EndpointIdentity } from '../endpoint-id.ts';
import { SharedWatch } from '../fs/shared-watch.ts';
import { FolderWatcher } from '../fs/watch.ts';
import { GitStatusWatcher } from '../git/status-watcher.ts';
import { worktreeAgents } from '../git/worktree-agents.ts';
import { checkoutHost } from '../git/worktree-host.ts';
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
    checkouts: CheckoutHost;
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
    return { watches, folders, statuses, worktrees, merges, checkouts: checkoutHost(worktrees) };
}
