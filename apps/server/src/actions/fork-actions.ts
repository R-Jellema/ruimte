import type { ActionHandlers } from '@ruimte/actions';
import { depthForOpening } from '../canvas/depth.ts';
import { modeForOpening } from '../canvas/mode.ts';
import { refuseOtherMachine } from '../canvas/remote-node.ts';
import { VerbRefusal } from '../canvas/verb.ts';
import { verbCallOf, type ServerActionContext } from './context.ts';

export const forkActions: ActionHandlers<ServerActionContext> = {
    'chat.fork': async ({ chatId, turnId, title, branch }, call) => {
        const { host } = call.context;
        const caller = call.actor.id;
        if (chatId === caller) {
            throw new VerbRefusal('self-fork', `${chatId} is you; fork is for a chat you opened yourself`);
        }
        /* Only a chat the caller opened, as the daemon wrote it down: forking any chat it can read would
           let an agent copy a person's conversation, or a sibling's, into a child of its own. */
        if ((host.agents?.startedBy(chatId) ?? null) !== caller) {
            throw new VerbRefusal('not-yours', `${chatId} is not a node you opened; you only fork a chat you opened yourself`);
        }
        refuseOtherMachine(host, chatId);
        const forks = host.forks;
        if (!forks) {
            throw new VerbRefusal('fork-unavailable', 'This machine does not fork chats');
        }
        const verbCall = verbCallOf(call);
        const depth = depthForOpening(verbCall, 'agent', 1);
        const ceiling = modeForOpening(verbCall, undefined);
        const result = await forks.fork(
            { chatId, turnId, ...(title == null ? {} : { title }), ...(branch == null ? {} : { branch }) },
            { id: caller, depth, ceiling, recount: () => depthForOpening(verbCall, 'agent', 1) }
        );
        return {
            output: {
                chatId: result.nodeId,
                nodeId: result.nodeId,
                viewId: result.viewId,
                chat: result.title,
                branch: result.worktree?.branch ?? null
            }
        };
    }
};
