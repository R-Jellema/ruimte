import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GitBranch } from 'lucide-react';
import type { AgentKind, GitRefsResult, ModelSelection } from '@ruimte/contracts';
import { createNodeAction, performAsPerson } from '@/actions/client-actions';
import { branchRefusal } from '@adecore/agents-react/chat/logic/fork';
import { defaultProvider, readChatPreferences, rememberChatSelection, startingSelection } from '@adecore/agents-react/chat/preferences';
import { ModelPicker } from '@adecore/agents-react/chat/ui/Pickers';
import { useProviders } from '@adecore/agents-react/state/providers';
import { Button, Dialog, ErrorBoundary, FieldHint, FormError, Icon, Input } from '@adecore/ui';
import { proposedBranch } from '@/shell/new-worktree-chat';
import { useProject } from '@/state/project';
import { useUi } from '@/state/ui';
import { useTransport } from '@/transport/context';

/*
 * A chat in a worktree made for it: a branch name, the base it starts at, and the chat node only
 * once the checkout exists. A refusal keeps the dialog open and makes nothing.
 */
export function NewWorktreeChatDialog() {
    const { t } = useTranslation('shell');
    const open = useUi((s) => s.newWorktreeChatOpen);
    const close = (): void => useUi.getState().setNewWorktreeChatOpen(false);
    return (
        <Dialog.Root
            open={open}
            onOpenChange={(next) => {
                if (!next) {
                    close();
                }
            }}
        >
            <Dialog.Popup size="sm">
                <Dialog.Title className="flex items-center gap-2">
                    <Icon icon={GitBranch} size={16} /> {t('newWorktreeChat.title')}
                </Dialog.Title>
                <ErrorBoundary label={t('newWorktreeChat.failed')} resetKeys={[open]}>
                    {open && <NewWorktreeChatForm onDone={close} />}
                </ErrorBoundary>
            </Dialog.Popup>
        </Dialog.Root>
    );
}

function NewWorktreeChatForm({ onDone }: { onDone(): void }) {
    const { t } = useTranslation(['shell', 'common']);
    const transport = useTransport();
    const folder = useProject((s) => s.current?.folder ?? null);
    const providers = useProviders((s) => s.providers);
    const pickable = providers.filter((entry) => entry.installed && entry.capabilities.chat);
    const [refs, setRefs] = useState<GitRefsResult | null>(null);
    const [branch, setBranch] = useState<string | null>(null);
    const [base, setBase] = useState<string | null>(null);
    const [commit, setCommit] = useState<{ ref: string; commit: string; subject: string } | 'missing' | null>(null);
    const [pick, setPick] = useState<{ provider: AgentKind; selection: ModelSelection | null } | null>(null);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);

    const locals = (refs?.refs ?? []).filter((ref) => ref.kind === 'local').map((ref) => ref.name);
    const branchName = (branch ?? (refs === null ? '' : proposedBranch(locals))).trim();
    const baseName = (base ?? refs?.current ?? '').trim();
    const branchProblem = refs === null ? null : branchRefusal(branchName, locals);
    const preferences = readChatPreferences();
    const chosenProvider = pick?.provider ?? pickable.find((entry) => entry.kind === defaultProvider(preferences))?.kind ?? pickable[0]?.kind ?? null;
    const chosenInfo = pickable.find((entry) => entry.kind === chosenProvider);
    const chosenSelection = pick?.selection ?? (chosenInfo ? startingSelection(preferences, chosenInfo) : null);
    const baseKnown = commit !== null && commit !== 'missing' && commit.ref === baseName;
    const ready = folder !== null && branchProblem === null && branchName !== '' && baseKnown && chosenProvider !== null && !busy;

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

    async function submit(): Promise<void> {
        if (!ready || chosenProvider === null) {
            return;
        }
        setBusy(true);
        setFailure(null);
        try {
            const { worktree } = await performAsPerson('worktree.create', { branch: branchName, base: baseName });
            if (chosenSelection !== null) {
                rememberChatSelection(chosenProvider, chosenSelection);
            }
            const nodeId = await createNodeAction('chat', { cwd: worktree.path, provider: chosenProvider });
            if (nodeId === null) {
                throw new Error(t('newWorktreeChat.noCanvas'));
            }
            onDone();
        } catch (e) {
            setFailure(e instanceof Error ? e.message : t('newWorktreeChat.failed'));
        } finally {
            setBusy(false);
        }
    }

    return (
        <>
            <Dialog.Text className="mt-1">{t('newWorktreeChat.description')}</Dialog.Text>
            <label className="mt-3 block text-xs text-text-muted" htmlFor="new-worktree-branch">
                {t('newWorktreeChat.branchLabel')}
            </label>
            <Input
                id="new-worktree-branch"
                mono
                autoFocus
                className="mt-1"
                value={branch ?? branchName}
                spellCheck={false}
                onChange={(e) => setBranch(e.target.value)}
                onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') {
                        void submit();
                    }
                }}
            />
            {branchProblem !== null && <FormError className="mt-1">{branchProblem}</FormError>}
            <label className="mt-3 block text-xs text-text-muted" htmlFor="new-worktree-base">
                {t('newWorktreeChat.baseLabel')}
            </label>
            <Input
                id="new-worktree-base"
                mono
                className="mt-1"
                list="new-worktree-refs"
                value={base ?? baseName}
                spellCheck={false}
                onChange={(e) => setBase(e.target.value)}
                onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') {
                        void submit();
                    }
                }}
            />
            <datalist id="new-worktree-refs">
                {(refs?.refs ?? []).map((ref) => (
                    <option key={`${ref.kind}:${ref.name}`} value={ref.name} />
                ))}
            </datalist>
            <FieldHint>
                {commit === 'missing'
                    ? t('newWorktreeChat.baseMissing')
                    : baseKnown
                      ? t('newWorktreeChat.baseCommit', { commit: commit.commit.slice(0, 7), subject: commit.subject })
                      : t('newWorktreeChat.baseLooking')}
            </FieldHint>
            {chosenProvider !== null && chosenSelection !== null && pickable.length > 0 && (
                <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="text-xs text-text-muted">{t('newWorktreeChat.model')}</span>
                    <ModelPicker
                        providers={pickable}
                        provider={chosenProvider}
                        selection={chosenSelection}
                        open={pickerOpen}
                        onOpenChange={setPickerOpen}
                        onChange={(provider, model) => setPick({ provider, selection: { model, options: {} } })}
                    />
                </div>
            )}
            {failure && <FormError className="mt-2">{failure}</FormError>}
            <Dialog.Footer>
                <Button onClick={onDone}>{t('common:action.cancel')}</Button>
                <Button variant="primary" disabled={!ready} onClick={() => void submit()}>
                    {busy ? t('newWorktreeChat.starting') : t('newWorktreeChat.start')}
                </Button>
            </Dialog.Footer>
        </>
    );
}
