import clsx from 'clsx';
import type { AgentKind } from '@ruimte/contracts';
import { AgentIcon } from '@adecore/agents-react/providers';

/*
 * The marks of the CLIs the shared `AgentIcon` has none for, in `currentColor`. Grok's is a ring crossed by a
 * slash, drawn here because no icon set this app takes carries it; Antigravity's is the one Google lists in
 * the ACP registry (agentclientprotocol/registry, `antigravity-acp/icon.svg`), in its own 16 by 16 box.
 */
const OWN_MARKS: Readonly<Record<string, { title: string; viewBox: string; paths: readonly string[] }>> = {
    antigravity: {
        title: 'Antigravity',
        viewBox: '0 0 16 16',
        paths: [
            'M14.1452 14.6818C14.9937 15.3182 16.2664 14.894 15.0997 13.7273C11.5998 10.3333 12.3421 1 7.99366 1C3.64518 1 4.3876 10.3333 0.887603 13.7273C-0.385123 15 0.993664 15.3182 1.84215 14.6818C5.13002 12.4545 4.9179 8.5303 7.99366 8.5303C11.0694 8.5303 10.8573 12.4545 14.1452 14.6818Z'
        ]
    },
    grok: {
        title: 'Grok',
        viewBox: '0 0 24 24',
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
            viewBox={mark.viewBox}
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
