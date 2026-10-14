import { useEffect, useRef, useState } from 'react';
import { MessageSquare, Terminal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ChatExternalSession, ChatSearchHit } from '@ruimte/contracts';
import { groupByChat } from '@/shell/palette-chats';
import { Icon, SectionLabel } from '@adecore/ui';
import { formatAgo } from '@adecore/ui/format';
import { CliMark } from '@adecore/agents-react/providers';
import type { ChatSearchState } from '@/shell/palette-chats';

/* The snippet with the match picked out. */
function Snippet({ hit }: { hit: ChatSearchHit }) {
    const end = hit.matchStart + hit.matchLength;
    return (
        <span className="min-w-0 truncate text-text-muted">
            {hit.snippet.slice(0, hit.matchStart)}
            <mark className="rounded-xs bg-accent-soft text-text">{hit.snippet.slice(hit.matchStart, end)}</mark>
            {hit.snippet.slice(end)}
        </span>
    );
}

function HitRow({ hit, active, id, onHover, onRun }: { hit: ChatSearchHit; active: boolean; id: string; onHover(): void; onRun(): void }) {
    const { t } = useTranslation('shell');
    const ref = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (active) {
            ref.current?.scrollIntoView({ block: 'nearest' });
        }
    }, [active]);

    return (
        <button
            ref={ref}
            id={id}
            role="option"
            tabIndex={-1}
            aria-selected={active}
            data-active={active}
            className="cursor-row flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm"
            onMouseEnter={onHover}
            onClick={onRun}
        >
            <span className="w-14 shrink-0 truncate text-xs text-text-faint">
                {t(hit.author === 'person' ? 'palette.authorPerson' : 'palette.authorAgent')}
            </span>
            <Snippet hit={hit} />
        </button>
    );
}

function ExternalRow({ session, active, id, onHover, onRun }: { session: ChatExternalSession; active: boolean; id: string; onHover(): void; onRun(): void }) {
    const { t } = useTranslation('shell');
    const ref = useRef<HTMLButtonElement>(null);
    const [now] = useState(() => Date.now());

    useEffect(() => {
        if (active) {
            ref.current?.scrollIntoView({ block: 'nearest' });
        }
    }, [active]);

    return (
        <button
            ref={ref}
            id={id}
            role="option"
            tabIndex={-1}
            aria-selected={active}
            data-active={active}
            className="cursor-row flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm"
            onMouseEnter={onHover}
            onClick={onRun}
        >
            <CliMark kind={session.provider} size={14} className="shrink-0" />
            <span className="min-w-0 truncate text-text-muted">{session.title === '' ? t('palette.untitledChat') : session.title}</span>
            <span className="grow" />
            <span className="shrink-0 text-xs text-text-faint">{formatAgo(now - session.updatedAt)}</span>
        </button>
    );
}

interface ResultsProps {
    search: ChatSearchState;
    /* The sessions started outside the app, numbered after the hits in the same flat list. */
    external: readonly ChatExternalSession[];
    /* Index into the hits, which is the flat list the arrow keys walk. */
    active: number;
    optionId(index: number): string;
    onHover(index: number): void;
    onRun(index: number): void;
}

/* Every hit under the chat it was found in. The arrows move from hit to hit through the flat list. */
export function PaletteChatResults({ search, external, active, optionId, onHover, onRun }: ResultsProps) {
    const { t } = useTranslation('shell');
    return (
        <>
            {groupByChat(search.hits, search.chats).map((group) => (
                <div key={group.chatId}>
                    <SectionLabel render={<div />} className="flex items-center gap-1.5 px-2.5 pt-1.5 pb-1">
                        <Icon icon={MessageSquare} size={14} className="shrink-0" />
                        <span className="min-w-0 truncate normal-case">{group.title}</span>
                        <span className="shrink-0 text-text-faint">{group.hits.length}</span>
                    </SectionLabel>
                    {group.hits.map((hit, index) => {
                        const at = group.offset + index;
                        return (
                            <HitRow
                                key={`${hit.chatId}:${hit.itemId}`}
                                id={optionId(at)}
                                hit={hit}
                                active={at === active}
                                onHover={() => onHover(at)}
                                onRun={() => onRun(at)}
                            />
                        );
                    })}
                </div>
            ))}
            {external.length > 0 && (
                <div>
                    <SectionLabel render={<div />} className="flex items-center gap-1.5 px-2.5 pt-1.5 pb-1">
                        <Icon icon={Terminal} size={14} className="shrink-0" />
                        <span>{t('palette.externalSessions')}</span>
                    </SectionLabel>
                    {external.map((session, index) => {
                        const at = search.hits.length + index;
                        return (
                            <ExternalRow
                                key={`${session.provider}:${session.sessionId}`}
                                id={optionId(at)}
                                session={session}
                                active={at === active}
                                onHover={() => onHover(at)}
                                onRun={() => onRun(at)}
                            />
                        );
                    })}
                </div>
            )}
        </>
    );
}
