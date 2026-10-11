import { useEffect, useState } from 'react';
import type { AgentKind, GitRefsResult, ModelSelection, Worktree } from '@ruimte/contracts';
import { branchRefusal } from '@adecore/agents-react/chat/logic/fork';
import { defaultProvider, readChatPreferences, startingSelection } from '@adecore/agents-react/chat/preferences';
import { useProviders } from '@adecore/agents-react/state/providers';
import { messageOf } from '@adecore/ui';
import { proposedBranch } from '@/shell/new-worktree-chat';
import { useTransport } from '@/transport/context';

export type BaseCommit = { ref: string; commit: string; subject: string } | 'missing' | null;

/* The branches a linked worktree has out, which a start reuses; the first entry is the main checkout, and a worktree gone from disk is no place to start. */
export function reusableBranches(worktrees: readonly Pick<Worktree, 'branch' | 'missing'>[]): Set<string> {
    return new Set(
        worktrees
            .slice(1)
            .filter((worktree) => worktree.missing !== true && worktree.branch !== '(detached)')
            .map((worktree) => worktree.branch)
    );
}

export interface WorktreeStart {
    folder: string;
    refs: GitRefsResult | null;
    /* Why the branches could not be read (not a git repository, no machine); null while it works or when it did. */
    refsFailure: string | null;
    branch: string;
    setBranch(branch: string): void;
    base: string;
    setBase(base: string): void;
    branchProblem: string | null;
    /* The branch already has a worktree: the start opens it, and a base does not apply. */
    reuses: boolean;
    commit: BaseCommit;
    baseKnown: boolean;
    provider: AgentKind | null;
    selection: ModelSelection | null;
    pickProvider(provider: AgentKind, selection: ModelSelection): void;
    /* Everything the fields need is filled in and valid. */
    ready: boolean;
}

/*
 * The branch, base and model a chat in a new worktree starts with. `proposed` is the branch the dialog
 * suggests; without one a short name is made up that no branch has.
 */
export function useWorktreeStart(folder: string | null, proposed: string | null = null): WorktreeStart | null {
    const transport = useTransport();
    const providers = useProviders((s) => s.providers);
    const pickable = providers.filter((entry) => entry.installed && entry.capabilities.chat);
    const [refs, setRefs] = useState<GitRefsResult | null>(null);
    const [refsFailure, setRefsFailure] = useState<string | null>(null);
    const [typedBranch, setBranch] = useState<string | null>(null);
    const [typedBase, setBase] = useState<string | null>(null);
    const [worktreeBranches, setWorktreeBranches] = useState<ReadonlySet<string>>(new Set());
    const [commit, setCommit] = useState<BaseCommit>(null);
    const [pick, setPick] = useState<{ provider: AgentKind; selection: ModelSelection } | null>(null);

    const locals = (refs?.refs ?? []).filter((ref) => ref.kind === 'local').map((ref) => ref.name);
    const branch = typedBranch ?? proposed ?? (refs === null ? '' : proposedBranch(locals));
    const base = typedBase ?? refs?.current ?? '';
    const baseName = base.trim();
    const preferences = readChatPreferences();
    const provider = pick?.provider ?? pickable.find((entry) => entry.kind === defaultProvider(preferences))?.kind ?? pickable[0]?.kind ?? null;
    const info = pickable.find((entry) => entry.kind === provider);
    const selection = pick?.selection ?? (info ? startingSelection(preferences, info) : null);
    const reuses = worktreeBranches.has(branch.trim());
    const branchProblem = refs === null || reuses ? null : branchRefusal(branch, locals);
    const baseKnown = commit !== null && commit !== 'missing' && commit.ref === baseName;

    useEffect(() => {
        if (folder === null) {
            return;
        }
        let current = true;
        transport
            .request('git.refs', { cwd: folder })
            .then((answer) => {
                if (current) {
                    setRefs(answer);
                    setRefsFailure(null);
                }
            })
            .catch((e: unknown) => {
                if (current) {
                    setRefsFailure(messageOf(e));
                }
            });
        return () => {
            current = false;
        };
    }, [transport, folder]);

    useEffect(() => {
        if (folder === null) {
            return;
        }
        let current = true;
        transport
            .request('git.worktree-list', { repo: folder })
            .then((answer) => {
                if (current) {
                    setWorktreeBranches(reusableBranches(answer.worktrees));
                }
            })
            .catch(() => undefined);
        return () => {
            current = false;
        };
    }, [transport, folder]);

    useEffect(() => {
        if (folder === null || baseName === '') {
            return;
        }
        let current = true;
        const timer = setTimeout(() => {
            transport
                .request('git.ref-commit', { cwd: folder, ref: baseName })
                .then((answer) => {
                    if (current) {
                        setCommit({ ref: baseName, ...answer });
                    }
                })
                .catch(() => {
                    if (current) {
                        setCommit('missing');
                    }
                });
        }, 200);
        return () => {
            current = false;
            clearTimeout(timer);
        };
    }, [transport, folder, baseName]);

    if (folder === null) {
        return null;
    }
    return {
        folder,
        refs,
        refsFailure,
        branch,
        setBranch,
        base,
        setBase,
        branchProblem,
        reuses,
        commit,
        baseKnown,
        provider,
        selection,
        pickProvider: (next, chosen) => setPick({ provider: next, selection: chosen }),
        ready: branchProblem === null && branch.trim() !== '' && (reuses || baseKnown) && provider !== null
    };
}
