import type { ActionHandlers } from '@ruimte/actions';
import { callerKind } from '../canvas/tasks.ts';
import { VerbRefusal, type SecretHost } from '../canvas/verb.ts';
import { launchHostOf, launchLines, named } from './launch-actions.ts';
import type { ServerActionContext } from './context.ts';

// The daemon hands every session these itself; a secret under one would take over its wiring.
const RESERVED_PREFIX = 'RUIMTE_';

function secretsOf({ host }: ServerActionContext): SecretHost {
    if (!host.secrets) {
        throw new VerbRefusal('no-secrets', 'This machine keeps no secrets for launches');
    }
    return host.secrets;
}

/* The card shows in the thread of an AI chat; a terminal's agent asks in its own TUI or in words. */
async function requireChat({ host, place }: ServerActionContext, caller: string): Promise<void> {
    const kind = callerKind(await host.projects.read(place.projectId), caller) ?? host.hiddenAgents?.get(caller)?.node.kind ?? null;
    if (kind !== 'chat') {
        throw new VerbRefusal(
            'secret-needs-chat',
            `A secret is asked for in a card of an AI chat, and you are ${kind === null ? 'not a node of this project' : `a ${kind}`}: ask the person to add it to the launch themselves`
        );
    }
}

export const secretActions: ActionHandlers<ServerActionContext> = {
    'secret.request': async ({ launch: wanted, variable, label, reason, placeholder, wait }, { actor, context }) => {
        const secrets = secretsOf(context);
        await requireChat(context, actor.id);
        if (variable.toUpperCase().startsWith(RESERVED_PREFIX)) {
            throw new VerbRefusal('reserved-variable', `${variable} is one of the variables this machine sets itself; pick another name`);
        }
        const { projectId } = context.place;
        const launches = await launchHostOf(context).list(projectId);
        const launch = named(launches, wanted);
        if (launch.kind === 'group') {
            throw new VerbRefusal(
                'launch-group',
                `${launch.name} is a group and has no environment of its own; ask for the secret of one of the launches it starts`,
                launchLines(launches.filter((candidate) => launch.members.includes(candidate.launchId)))
            );
        }
        const { requestId, outcome } = await secrets.ask(
            {
                nodeId: actor.id,
                projectId,
                launchId: launch.launchId,
                launchName: launch.name,
                variable,
                label,
                reason,
                ...(placeholder ? { placeholder } : {})
            },
            wait ? wait * 1000 : undefined
        );
        return { output: { requestId, outcome, launchId: launch.launchId, name: launch.name, variable } };
    }
};
