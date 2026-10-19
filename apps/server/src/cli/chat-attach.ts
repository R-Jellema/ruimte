import { basename } from 'node:path';
import { AGENT_IMAGE_BYTES, AGENT_MODEL_BYTES, agentAttachmentBytes, agentAttachmentType } from '../chat/attachment-type.ts';
import { readAtMost } from './visual-images.ts';

const HELP_LINE = 'detail\truimte-context help chat attach';

const MIB = 1024 * 1024;

export type PreparedAttachment = { argv: string[] } | { refusal: { code: string; message: string; lines: string[] } };

function refusal(code: string, message: string): PreparedAttachment {
    return { refusal: { code, message, lines: [HELP_LINE] } };
}

/*
 * The words `chat attach` sends: the file read here, in the agent's own process and sandbox, and put
 * in `--data` as base64, since the daemon never opens a path an agent names. Any other word is
 * passed on, so the daemon refuses an argument this side does not know.
 */
export async function prepareAttachment(file: string, name: string | null, rest: readonly string[]): Promise<PreparedAttachment> {
    const buffer = Buffer.alloc(AGENT_MODEL_BYTES + 1);
    let length: number;
    try {
        length = await readAtMost(file, buffer);
    } catch (e) {
        const code = e instanceof Error && 'code' in e && typeof e.code === 'string' ? e.code : null;
        const why = code === 'EACCES' || code === 'EPERM' ? 'this process may not read it' : 'there is no regular file there';
        return refusal('attach-unreadable', `${file} could not be attached: ${why}`);
    }
    if (length > AGENT_MODEL_BYTES) {
        return refusal(
            'attach-too-large',
            `${file} is more than the ${AGENT_MODEL_BYTES / MIB} MiB a model may be, and an image ${AGENT_IMAGE_BYTES / MIB} MiB`
        );
    }
    const bytes = buffer.subarray(0, length);
    const type = agentAttachmentType(bytes);
    if (type === null) {
        return refusal('attach-not-image', `${file} is no image or model: its bytes are not a PNG, JPEG, GIF or WebP, nor a binary glTF, USDZ or STL`);
    }
    if (length > agentAttachmentBytes(type.kind)) {
        return refusal('attach-too-large', `${file} is more than the ${AGENT_IMAGE_BYTES / MIB} MiB an image may be`);
    }
    return { argv: [...rest, '--name', name ?? basename(file), `--data=${bytes.toString('base64')}`] };
}
