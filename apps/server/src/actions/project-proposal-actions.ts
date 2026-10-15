import { isAbsolutePath } from '@ruimte/contracts';
import type { ActionHandlers } from '@ruimte/actions';
import { VerbRefusal } from '../canvas/verb.ts';
import type { ServerActionContext } from './context.ts';

export const projectProposalActions: ActionHandlers<ServerActionContext> = {
    'project.propose': async ({ name, folder, reason }, { actor, context }) => {
        const { proposals } = context.host;
        if (!proposals) {
            throw new VerbRefusal('no-proposals', 'This machine keeps no suggestions of projects');
        }
        if (!proposals.inChats(actor.id)) {
            throw new VerbRefusal(
                'not-in-chats',
                'A project is suggested from a chat in Chats; a chat that already lives in a project, and a terminal, have nothing to move'
            );
        }
        if (folder && !isAbsolutePath(folder)) {
            throw new VerbRefusal('folder-not-absolute', `${folder} is not an absolute path; name the full folder on this machine, or leave --folder out`);
        }
        const answer = await proposals.propose({ chatId: actor.id, name, ...(folder ? { folder } : {}), reason });
        return { output: answer };
    }
};
