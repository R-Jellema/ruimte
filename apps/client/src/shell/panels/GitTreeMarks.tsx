import { ArrowDown, ArrowUp, CircleAlert, type LucideIcon } from 'lucide-react';
import { FileTree, Icon } from '@adecore/ui';
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
                return (
                    <span
                        key={index}
                        style={{ color: part.color }}
                        className={
                            part.kind === 'branch'
                                ? 'max-w-36 truncate rounded-sm bg-surface-raised px-1.5 py-0.5 font-sans text-2xs'
                                : part.kind === 'count'
                                  ? 'font-sans'
                                  : undefined
                        }
                    >
                        {part.text}
                    </span>
                );
            })}
        </FileTree.Decoration>
    );
}
