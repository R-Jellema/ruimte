import type { ActionHandlers } from '@ruimte/actions';
import { VerbRefusal } from '../canvas/verb.ts';
import { AGENT_IMAGE_TYPES } from '../chat/agent-images.ts';
import { imageType, VISUAL_IMAGE_BYTES } from '../cli/visual-images.ts';
import type { ServerActionContext } from './context.ts';
import { callerNodeKind } from './visual-actions.ts';

const HELP_LINE = 'detail\truimte-context help chat attach';

const MIB = 1024 * 1024;

export const chatAttachActions: ActionHandlers<ServerActionContext> = {
    'chat.attach': async ({ name, data }, { actor, context }) => {
        const images = context.host.agentImages;
        if (!images) {
            throw new VerbRefusal('unavailable', 'This machine keeps no images for a chat; describe the image in text');
        }
        const kind = await callerNodeKind(context, actor.id);
        if (kind !== 'chat') {
            throw new VerbRefusal(
                'attach-needs-chat',
                `An image attaches only to the thread of an AI chat, and you are ${kind === null ? 'not a node of this project' : `a ${kind}`}: describe it in text instead`,
                [HELP_LINE]
            );
        }
        const bytes = Buffer.from(data, 'base64');
        if (bytes.byteLength > VISUAL_IMAGE_BYTES) {
            throw new VerbRefusal(
                'attach-too-large',
                `The image is ${Math.ceil(bytes.byteLength / MIB)} MiB and at most ${VISUAL_IMAGE_BYTES / MIB} MiB attach`,
                [HELP_LINE]
            );
        }
        // The bytes decide the type: the daemon trusts no CLI to have checked them.
        const mime = imageType(bytes);
        if (mime === null || AGENT_IMAGE_TYPES[mime] === undefined) {
            throw new VerbRefusal(
                'attach-not-image',
                `Only a ${Object.values(AGENT_IMAGE_TYPES).join(', ')} image attaches, and these bytes are ${mime ?? 'no image'}`,
                [HELP_LINE]
            );
        }
        const attachment = await images.attach(actor.id, { name, mime, bytes });
        return { output: { attachment: { id: attachment.id, name: attachment.name, mime: attachment.mime, size: attachment.size } } };
    }
};
