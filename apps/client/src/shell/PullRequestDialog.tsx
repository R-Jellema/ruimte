import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleCheck, CircleDashed, CircleX, ExternalLink, Eye, EyeOff, GitPullRequest, RefreshCw } from 'lucide-react';
import type { GitPrCheck, GitPrThread, GitPullRequest as PullRequest } from '@ruimte/contracts';
import { AgentIcon } from '@adecore/agents-react/agents/AgentIcon';
import { Button, Dialog, ErrorBoundary, FormError, Icon, IconButton, Menu, Pill, Switch, Tooltip } from '@adecore/ui';
import { useChooserSections } from '@/chat/chat-chooser';
import { sendToChat } from '@/chat/selection-to-chat';
import { desktop } from '@/desktop/bridge';
import { groupChecks, mergeStateKey, threadBlock, visibleThreads } from '@/shell/pr-view';
import { stopPrWatch } from '@/shell/pr-watch-actions';
import { endpointKey, isOfEndpoint, useEndpointId } from '@/state/keys';
import { usePrWatches } from '@/state/pr-watches';
import { useProject } from '@/state/project';
import { useUi } from '@/state/ui';
import { useTransport } from '@/transport/context';

/*
 * A pull request read-only: its checks, how it stands to merge and its review threads. A thread can be
 * copied into a chat's prompt, and nothing here sends, merges or answers anything.
 */
export function PullRequestDialog() {
    const { t } = useTranslation('panels');
    const request = useUi((s) => s.pullRequestDialog);
    const close = (): void => useUi.getState().setPullRequestDialog(null);
    return (
        <Dialog.Root
            open={request !== null}
            onOpenChange={(open) => {
                if (!open) {
                    close();
                }
            }}
        >
            <Dialog.Popup className="flex h-[640px] w-[800px] flex-col overflow-hidden">
                <Dialog.Title className="flex items-center gap-2">
                    <Icon icon={GitPullRequest} size={16} /> {t('git.pr.title')}
                </Dialog.Title>
                <ErrorBoundary label={t('git.pr.failed')} resetKeys={[request?.cwd]}>
                    {request !== null && <PullRequestView key={request.cwd} cwd={request.cwd} onDone={close} />}
                </ErrorBoundary>
            </Dialog.Popup>
        </Dialog.Root>
    );
}

function openLink(url: string): void {
    if (!/^https:\/\//.test(url)) {
        return;
    }
    const bridge = desktop();
    if (bridge) {
        void bridge.openExternal(url);
    } else {
        window.open(url, '_blank', 'noopener,noreferrer');
    }
}

type Reading = ({ pr: PullRequest | null } | { error: string }) & { attempt: number };

function PullRequestView({ cwd, onDone }: { cwd: string; onDone(): void }) {
    const { t } = useTranslation(['panels', 'common']);
    const transport = useTransport();
    const [reading, setReading] = useState<Reading | null>(null);
    // Goes up to read again; the answer of an older attempt is never shown.
    const [attempt, setAttempt] = useState(0);
    const [showBots, setShowBots] = useState(false);
    const [showResolved, setShowResolved] = useState(false);
    const busy = reading === null || reading.attempt !== attempt;

    useEffect(() => {
        let current = true;
        transport
            .request('git.pr', { cwd })
            // A refetch replaces the whole answer, so the checks of an older head never carry over.
            .then((answer) => current && setReading({ pr: answer.pr, attempt }))
            .catch((e: unknown) => current && setReading({ error: e instanceof Error ? e.message : t('git.pr.failed'), attempt }));
        return () => {
            current = false;
        };
    }, [transport, cwd, attempt, t]);

    const pr = reading !== null && 'pr' in reading ? reading.pr : null;
    return (
        <>
            <div className="mt-1 flex items-center gap-2">
                {pr !== null && (
                    <>
                        <Pill mono>
                            {pr.repo}#{pr.number}
                        </Pill>
                        <span className="min-w-0 truncate text-sm text-text">{pr.title}</span>
                        <IconButton icon={ExternalLink} size="sm" label={t('git.pr.open')} onClick={() => openLink(pr.url)} />
                    </>
                )}
                <span className="grow" />
                {pr !== null && pr.state === 'OPEN' && <PullRequestWatch cwd={cwd} pr={pr} />}
                <IconButton icon={RefreshCw} size="sm" label={t('git.pr.refresh')} disabled={busy} onClick={() => setAttempt((count) => count + 1)} />
            </div>
            <div className="mt-3 min-h-0 grow overflow-y-auto pr-1">
                {reading === null && <p className="text-sm text-text-muted">{t('git.pr.loading')}</p>}
                {reading !== null && 'error' in reading && <FormError>{reading.error}</FormError>}
                {reading !== null && 'pr' in reading && pr === null && <p className="text-sm text-text-muted">{t('git.pr.none')}</p>}
                {pr !== null && (
                    <>
                        <PullRequestHeader pr={pr} />
                        <PullRequestChecks checks={pr.checks} />
                        <PullRequestThreads pr={pr} showBots={showBots} showResolved={showResolved} onBots={setShowBots} onResolved={setShowResolved} />
                    </>
                )}
            </div>
            <Dialog.Footer>
                <Button onClick={onDone}>{t('common:action.close')}</Button>
            </Dialog.Footer>
        </>
    );
}

/* The reason a watch could not start in the person's words: the machine's code when it has one, else its message. */
function watchFailure(error: unknown, t: (key: string) => string): string {
    if ((error as { code?: unknown } | null)?.code === 'folder-missing') {
        return t('git.pr.watch.folderMissing');
    }
    return error instanceof Error ? error.message : t('git.pr.watch.failed');
}

/* Which chat the machine wakes when this pull request's checks finish or a review comes in. */
function PullRequestWatch({ cwd, pr }: { cwd: string; pr: PullRequest }) {
    const { t } = useTranslation('panels');
    const transport = useTransport();
    const endpointId = useEndpointId();
    const projectId = useProject((state) => state.current?.projectId ?? null);
    const sections = useChooserSections([]);
    const chats = [...sections.here, ...sections.others];
    const watches = usePrWatches((state) => state.byChat);
    const watching = Object.entries(watches).filter(([key, watch]) => isOfEndpoint(key, endpointId) && watch.repo === pr.repo && watch.number === pr.number);
    const ended = usePrWatches((state) => state.ended);
    const endedHere = chats.flatMap((chat) => {
        const reason = ended[endpointKey(endpointId, chat.id)];
        return reason === undefined ? [] : [{ chat, reason }];
    });
    const [error, setError] = useState<string | null>(null);
    const start = (chatId: string): void => {
        if (projectId === null) {
            return;
        }
        setError(null);
        usePrWatches.getState().dismissEnded(endpointId, chatId);
        transport.request('git.pr-watch', { projectId, chatId, cwd, number: pr.number }).catch((e: unknown) => setError(watchFailure(e, t)));
    };
    return (
        <>
            {error !== null && <span className="text-xs text-status-error">{error}</span>}
            {endedHere.map(({ chat, reason }) => (
                <Button key={chat.id} size="xs" onClick={() => usePrWatches.getState().dismissEnded(endpointId, chat.id)}>
                    {chat.title}: {t(`git.pr.watch.${reason === 'folder-missing' ? 'folderMissing' : reason}`)}
                </Button>
            ))}
            {watching.map(([key, watch]) => (
                <Tooltip key={key} label={t('git.pr.watch.stop')}>
                    <Button size="xs" onClick={() => void stopPrWatch(endpointId, watch.chatId)}>
                        <Icon icon={EyeOff} size={12} />{' '}
                        {t('git.pr.watch.watching', { chat: chats.find((chat) => chat.id === watch.chatId)?.title ?? watch.chatId })}
                    </Button>
                </Tooltip>
            ))}
            <Menu.Root>
                <Tooltip label={t('git.pr.watch.forChatHint')}>
                    <Menu.Trigger render={<Button size="xs" disabled={chats.length === 0 || projectId === null} />}>
                        <Icon icon={Eye} size={12} /> {t('git.pr.watch.forChat')}
                    </Menu.Trigger>
                </Tooltip>
                <Menu.Popup align="end">
                    {chats.map((chat) => (
                        <Menu.Item key={chat.id} onClick={() => start(chat.id)}>
                            {chat.provider !== null && <AgentIcon kind={chat.provider} />}
                            <span className="min-w-0 truncate">{chat.title}</span>
                        </Menu.Item>
                    ))}
                </Menu.Popup>
            </Menu.Root>
        </>
    );
}

function PullRequestHeader({ pr }: { pr: PullRequest }) {
    const { t } = useTranslation('panels');
    return (
        <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
            <span className="font-mono">
                {pr.headBranch} → {pr.baseBranch}
            </span>
            <Pill>{pr.state.toLowerCase()}</Pill>
            {pr.isDraft && <Pill>{t('git.pr.draft')}</Pill>}
            <span>{t(`git.pr.merge.${mergeStateKey(pr)}`)}</span>
            {pr.reviewDecision !== null && (
                <span>{t(`git.pr.merge.review.${pr.reviewDecision.toLowerCase()}`, { defaultValue: pr.reviewDecision.toLowerCase() })}</span>
            )}
        </div>
    );
}

function CheckRow({ check }: { check: GitPrCheck }) {
    const mark = check.state === 'failure' ? CircleX : check.state === 'pending' ? CircleDashed : CircleCheck;
    const tone = check.state === 'failure' ? 'text-status-error' : check.state === 'pending' ? 'text-status-needs-you' : 'text-status-done';
    return (
        <li className="flex items-center gap-2 py-0.5 text-sm">
            <Icon icon={mark} size={14} className={tone} />
            <span className="min-w-0 truncate text-text">{check.name}</span>
            {(check.workflow !== undefined || check.event !== undefined) && (
                <span className="shrink-0 text-xs text-text-faint">{[check.workflow, check.event].filter(Boolean).join(' · ')}</span>
            )}
            <span className="grow" />
            {check.url !== undefined && <IconButton icon={ExternalLink} size="sm" label={check.name} onClick={() => openLink(check.url!)} />}
        </li>
    );
}

function PullRequestChecks({ checks }: { checks: readonly GitPrCheck[] }) {
    const { t } = useTranslation('panels');
    const groups = groupChecks(checks);
    if (checks.length === 0) {
        return <p className="mt-4 text-sm text-text-muted">{t('git.pr.noChecks')}</p>;
    }
    return (
        <section className="mt-4">
            <h3 className="text-xs font-medium text-text-muted">{t('git.pr.checks')}</h3>
            {groups.failed.length > 0 && (
                <>
                    <p className="mt-2 text-xs text-status-error">{t('git.pr.checksFailed', { count: groups.failed.length })}</p>
                    <ul>
                        {groups.failed.map((check) => (
                            <CheckRow key={check.key} check={check} />
                        ))}
                    </ul>
                </>
            )}
            {groups.pending.length > 0 && (
                <>
                    <p className="mt-2 text-xs text-text-muted">{t('git.pr.checksPending', { count: groups.pending.length })}</p>
                    <ul>
                        {groups.pending.map((check) => (
                            <CheckRow key={check.key} check={check} />
                        ))}
                    </ul>
                </>
            )}
            {groups.passed.length > 0 && <p className="mt-2 text-xs text-text-muted">{t('git.pr.checksPassed', { count: groups.passed.length })}</p>}
        </section>
    );
}

interface ThreadsProps {
    pr: PullRequest;
    showBots: boolean;
    showResolved: boolean;
    onBots(on: boolean): void;
    onResolved(on: boolean): void;
}

function PullRequestThreads({ pr, showBots, showResolved, onBots, onResolved }: ThreadsProps) {
    const { t } = useTranslation('panels');
    const view = visibleThreads(pr.threads, { showBots, showResolved });
    return (
        <section className="mt-4">
            <div className="flex items-center gap-3">
                <h3 className="text-xs font-medium text-text-muted">{t('git.pr.threads', { count: pr.threads.length })}</h3>
                <span className="grow" />
                <label className="flex items-center gap-2 text-xs text-text-muted">
                    {t('git.pr.showBots')}
                    <Switch label={t('git.pr.showBots')} checked={showBots} onCheckedChange={onBots} />
                </label>
                <label className="flex items-center gap-2 text-xs text-text-muted">
                    {t('git.pr.showResolved')}
                    <Switch label={t('git.pr.showResolved')} checked={showResolved} onCheckedChange={onResolved} />
                </label>
            </div>
            {view.hiddenBots + view.hiddenResolved > 0 && (
                <p className="mt-1 text-xs text-text-faint">{t('git.pr.hidden', { bots: view.hiddenBots, resolved: view.hiddenResolved })}</p>
            )}
            <ul className="mt-2 flex flex-col gap-2">
                {view.shown.map((thread) => (
                    <ThreadCard key={thread.id} pr={pr} thread={thread} />
                ))}
            </ul>
        </section>
    );
}

function ThreadCard({ pr, thread }: { pr: PullRequest; thread: GitPrThread }) {
    const { t } = useTranslation('panels');
    const sections = useChooserSections([]);
    const chats = [...sections.here, ...sections.others];
    return (
        <li className="rounded-lg border border-border p-3">
            <div className="flex items-center gap-2 text-xs text-text-muted">
                {thread.path !== undefined && (
                    <span className="min-w-0 truncate font-mono">
                        {thread.path}
                        {thread.line !== undefined && `:${thread.line}`}
                    </span>
                )}
                {thread.resolved && <Pill>{t('git.pr.resolved')}</Pill>}
                {thread.outdated && <Pill>{t('git.pr.outdated')}</Pill>}
                <span className="grow" />
                <Menu.Root>
                    <Tooltip label={t('git.pr.copyToChatHint')}>
                        <Menu.Trigger render={<Button size="xs" disabled={chats.length === 0} />}>{t('git.pr.copyToChat')}</Menu.Trigger>
                    </Tooltip>
                    <Menu.Popup align="end">
                        {chats.map((chat) => (
                            <Menu.Item key={chat.id} onClick={() => sendToChat(chat.id, threadBlock(pr, thread))}>
                                {chat.provider !== null && <AgentIcon kind={chat.provider} />}
                                <span className="min-w-0 truncate">{chat.title}</span>
                            </Menu.Item>
                        ))}
                    </Menu.Popup>
                </Menu.Root>
            </div>
            {thread.comments.map((comment, index) => (
                <div key={`${comment.url}:${index}`} className="mt-2">
                    <p className="text-xs text-text-muted">
                        {comment.author}
                        {comment.bot && ` (${t('git.pr.bot')})`}
                    </p>
                    <p className="mt-0.5 whitespace-pre-wrap text-sm text-text">{comment.body}</p>
                </div>
            ))}
            {thread.truncated === true && <p className="mt-2 text-xs text-text-faint">{t('git.pr.truncated')}</p>}
        </li>
    );
}
