import { ArrowDown, ArrowUp, CircleAlert, type LucideIcon } from 'lucide-react';
import { FileTree, Icon, Pill } from '@adecore/ui';
import type { DecorationPart } from './git-tree';

const MARKS: Partial<Record<NonNullable<DecorationPart['kind']>, LucideIcon>> = {
    ahead: ArrowUp,
    behind: ArrowDown,
    'needs-you': CircleAlert
};

export function GitTreeMarks({ parts }: { parts: readonly DecorationPart[] }) {
    return (
        <FileTree.Decoration className="font-mono text-2xs tabular-nums">
            {parts.map((part, index) => {
                const mark = part.kind === undefined ? undefined : MARKS[part.kind];
                if (mark !== undefined) {
                    return (
                        <span
                            key={index}
                            role="img"
                            aria-label={part.label}
                            style={{ color: part.color }}
                            className="flex shrink-0 items-center gap-0.5 font-sans"
                        >
                            <Icon icon={mark} size={12} />
                            {part.text}
                        </span>
                    );
                }
                if (part.kind === 'branch') {
                    return (
                        <Pill key={index} mono size="sm" className="max-w-36">
                            <span className="min-w-0 truncate">{part.text}</span>
                        </Pill>
                    );
                }
                return (
                    <span key={index} style={{ color: part.color }} className={part.kind === 'count' ? 'font-sans' : undefined}>
                        {part.text}
                    </span>
                );
            })}
        </FileTree.Decoration>
    );
}
