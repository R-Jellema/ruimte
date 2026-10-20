import clsx from 'clsx';
import type { AgentKind } from '@ruimte/contracts';
import { AgentIcon } from '@adecore/agents-react/providers';

/*
 * The marks of the CLIs the shared `AgentIcon` has none for, in its 24 by 24 box and `currentColor`.
 * Grok's is a ring crossed by a slash, drawn here because no icon set this app takes carries it.
 */
const OWN_MARKS: Readonly<Record<string, { title: string; paths: readonly string[] }>> = {
    grok: {
        title: 'Grok',
        paths: ['M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 1 0 0-17Zm0 2a6.5 6.5 0 1 1 0 13 6.5 6.5 0 1 1 0-13Z', 'M2.6 20 20 2.6l1.4 1.4L4 21.4Z']
    }
};

/* The mark of an agent's CLI; a kind this version knows no mark for gets the shared neutral one. */
export function AgentMark({ kind, size = 14, className }: { kind: AgentKind; size?: number; className?: string }) {
    const mark = OWN_MARKS[kind];
    if (mark === undefined) {
        return <AgentIcon kind={kind} size={size} className={className} />;
    }
    return (
        <svg
            role="img"
            aria-label={mark.title}
            viewBox="0 0 24 24"
            width={size}
            height={size}
            fill="currentColor"
            fillRule="evenodd"
            className={clsx('align-middle', className)}
        >
            {mark.paths.map((path) => (
                <path key={path} d={path} />
            ))}
        </svg>
    );
}
