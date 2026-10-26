import type { ActionHandlers } from '@ruimte/actions';
import { hostService, type ServerActionContext } from './context.ts';

function artifactsOf(context: ServerActionContext) {
    return hostService(context, 'artifacts', 'unavailable', 'This machine keeps no Output; say what you made in text');
}

/* Every call is held to the caller's own project, which the daemon reads off the caller and never off an argument. */
export const artifactActions: ActionHandlers<ServerActionContext> = {
    'artifact.publish': async (input, { actor, context }) => {
        const { result, artifact, version } = await artifactsOf(context).publish(actor.id, input);
        return { output: { artifact, version, existing: result.existing } };
    },
    'artifact.list': async (_input, { context }) => ({
        output: { artifacts: await artifactsOf(context).list({ projectId: context.place.projectId }) }
    }),
    'artifact.read': async (input, { context }) => ({
        output: await artifactsOf(context).read(context.place.projectId, input)
    })
};
