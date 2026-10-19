import { z } from 'zod';
import { AGENT_ATTACHMENT_LIMIT } from '../chat/agent-images.ts';
import { AGENT_IMAGE_BYTES, AGENT_MODEL_BYTES, AGENT_MODEL_TYPES } from '../chat/attachment-type.ts';
import { defineActionVerb, runAction } from './action-verb.ts';
import { field, SCOPE_LINE, VerbRefusal } from './verb.ts';

export const CHAT_SUMMARY = 'Puts an image or 3D model file of your own in the thread of this chat, so a block can show it';

const MIB = 1024 * 1024;

const attach = defineActionVerb('chat', {
    name: 'attach',
    action: 'chat.attach',
    usage: '--file <path> [--name N]',
    params: [
        {
            syntax: '--file <path>',
            need: 'required',
            text: 'An image or model file in your own sandbox; ruimte-context reads it and sends its bytes, so the daemon never opens a path'
        },
        { syntax: '--name N', need: 'optional', field: 'name', more: 'the file name without its folder when omitted' },
        { syntax: '--data B', need: 'optional', field: 'data', more: 'ruimte-context fills this from --file; there is no reason to write it yourself' }
    ],
    detail: [
        `limits\tPNG, JPEG, GIF and WebP images of at most ${AGENT_IMAGE_BYTES / MIB} MiB, binary glTF, USDZ and STL models of at most ${AGENT_MODEL_BYTES / MIB} MiB, ${AGENT_ATTACHMENT_LIMIT} per chat together; the type is read off the bytes, not the name`,
        'prints\tattachment\tid\tname\tmime\tsize\tthe id to write as attachment',
        'use\t<Image attachment="<id>" alt="..."/> in a ruimte-ui block, and Gallery and Compare take ids the same way; a model is <Model attachment="<id>">caption</Model>, shown only when the person asks to see it',
        'chat\tOnly an AI chat takes one, in any permission mode: it changes nothing but your own thread. It goes with a clear or a deletion of the chat',
        'refusals\tattach-needs-chat\tattach-unreadable\tattach-not-image\tattach-too-large\tattach-limit\tthe codes this action refuses with; attach-not-image also means no model',
        'see\truimte-context help ui content\tthe components that show it'
    ],
    positionals: z.tuple([], { error: 'chat attach takes no arguments; name the file with --file' }),
    flags: z.object({
        file: z.string().optional(),
        name: z.string().trim().min(1, 'chat attach needs --name, or --file to take it from').optional(),
        data: z.string().optional()
    }),
    async run({ flags }, call) {
        if (flags.data === undefined || flags.name === undefined) {
            // Only ruimte-context reads the file; a call that skipped it has no bytes to attach.
            throw new VerbRefusal('bad-arguments', 'chat attach needs --file <path>, which ruimte-context reads before it asks the daemon', [
                'detail\truimte-context help chat attach'
            ]);
        }
        const { attachment } = await runAction(call, 'chat.attach', { name: flags.name, data: flags.data });
        return [
            `attachment\t${attachment.id}\t${field(attachment.name)}\t${attachment.mime}\t${attachment.size}`,
            AGENT_MODEL_TYPES[attachment.mime] === undefined
                ? `next\tShow it with <Image attachment="${attachment.id}" alt="..."/> in a ruimte-ui block`
                : `next\tShow it with <Model attachment="${attachment.id}">caption</Model> in a ruimte-ui block once the person asks to see it`
        ];
    }
});

export const CHAT_DETAIL: readonly string[] = [SCOPE_LINE];

export const CHAT_ACTIONS = [attach] as const;
