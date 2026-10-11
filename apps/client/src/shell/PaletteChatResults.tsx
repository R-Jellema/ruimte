import { useEffect, useRef } from 'react';
import { MessageSquare } from 'lucide-react';
import type { ChatSearchHit } from '@ruimte/contracts';
import { groupByChat } from '@/shell/palette-chats';
import { Icon, SectionLabel } from '@adecore/ui';
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
            aria-selected={active}
            data-active={active}
            className="cursor-row flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm"
            onMouseEnter={onHover}
            onClick={onRun}
        >
            <span className="w-14 shrink-0 text-xs text-text-faint">{hit.author === 'person' ? '›' : '‹'}</span>
            <Snippet hit={hit} />
        </button>
    );
}

interface ResultsProps {
    search: ChatSearchState;
    /* Index into the hits, which is the flat list the arrow keys walk. */
    active: number;
    optionId(index: number): string;
    onHover(index: number): void;
    onRun(index: number): void;
}

/* Every hit under the chat it was found in. The arrows move from hit to hit through the flat list. */
export function PaletteChatResults({ search, active, optionId, onHover, onRun }: ResultsProps) {
    return (
        <>
            {groupByChat(search.hits, search.chats).map((group) => (
                <div key={group.chatId}>
                    <SectionLabel render={<div />} className="flex items-center gap-1.5 px-2.5 pt-1.5 pb-1">
                        <Icon icon={MessageSquare} size={14} className="shrink-0" />
                        <span className="min-w-0 truncate normal-case">{group.title}</span>
                        <span className="text-text-faint">{group.hits.length}</span>
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
        </>
    );
}
