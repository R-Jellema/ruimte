import { useEffect, useState } from 'react';
import type { AgentKind, GitRefsResult, ModelSelection } from '@ruimte/contracts';
import { branchRefusal } from '@adecore/agents-react/chat/logic/fork';
import { defaultProvider, readChatPreferences, startingSelection } from '@adecore/agents-react/chat/preferences';
import { useProviders } from '@adecore/agents-react/state/providers';
import { proposedBranch } from '@/shell/new-worktree-chat';
import { useTransport } from '@/transport/context';

export type BaseCommit = { ref: string; commit: string; subject: string } | 'missing' | null;

export interface WorktreeStart {
    folder: string;
    refs: GitRefsResult | null;
    branch: string;
    setBranch(branch: string): void;
    base: string;
    setBase(base: string): void;
    branchProblem: string | null;
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
    const [typedBranch, setBranch] = useState<string | null>(null);
    const [typedBase, setBase] = useState<string | null>(null);
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
    const branchProblem = refs === null ? null : branchRefusal(branch, locals);
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
        branch,
        setBranch,
        base,
        setBase,
        branchProblem,
        commit,
        baseKnown,
        provider,
        selection,
        pickProvider: (next, chosen) => setPick({ provider: next, selection: chosen }),
        ready: branchProblem === null && branch.trim() !== '' && baseKnown && provider !== null
    };
}
