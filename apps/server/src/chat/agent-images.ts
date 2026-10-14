import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AttachmentStore } from '@adecore/agents/chat';
import { CodedError } from '@adecore/agents';
import type { ChatAttachment } from '@ruimte/contracts';

/* What an agent may put in its chat; the folder goes with a clear or a deletion of the chat, so nothing here keeps an index. */
export const AGENT_IMAGE_LIMIT = 64;

/* The formats every client draws; an SVG could run script when opened on its own, so it stays out. */
export const AGENT_IMAGE_TYPES: Readonly<Record<string, string>> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp'
};

const ID = /^agent-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

const MIME_OF: Readonly<Record<string, string>> = Object.fromEntries(Object.entries(AGENT_IMAGE_TYPES).map(([mime, extension]) => [extension, mime]));

/*
 * The images an agent attached to its own chat, as `agent-<uuid>.<ext>` in the chat's attachment
 * folder. The id is the file's name, so a lookup is a stat and an unrelated attachment is never read.
 */
export class AgentImages {
    private readonly attachments: Pick<AttachmentStore, 'folderOf'>;

    constructor(attachments: Pick<AttachmentStore, 'folderOf'>) {
        this.attachments = attachments;
    }

    /* Stores bytes whose type the caller already checked against `AGENT_IMAGE_TYPES`; refuses past the per-chat limit. */
    async save(chatId: string, upload: { name: string; mime: string; bytes: Uint8Array }): Promise<ChatAttachment> {
        const extension = AGENT_IMAGE_TYPES[upload.mime];
        if (extension === undefined) {
            throw new CodedError('attach-not-image', `${upload.mime} is not an image type a chat can show`);
        }
        const folder = this.attachments.folderOf(chatId);
        if ((await this.names(folder)).length >= AGENT_IMAGE_LIMIT) {
            throw new CodedError('attach-limit', `This chat already holds ${AGENT_IMAGE_LIMIT} images you attached; show one of those again instead`);
        }
        await mkdir(folder, { recursive: true, mode: 0o700 });
        const id = `agent-${randomUUID()}`;
        const path = join(folder, `${id}.${extension}`);
        await writeFile(path, upload.bytes, { mode: 0o600 });
        return { id, name: upload.name, mime: upload.mime, size: upload.bytes.byteLength, path };
    }

    /* The image behind an id, or null when the id is no agent image of this chat. */
    async find(chatId: string, id: string): Promise<ChatAttachment | null> {
        if (!ID.test(id)) {
            return null;
        }
        const folder = this.attachments.folderOf(chatId);
        for (const [extension, mime] of Object.entries(MIME_OF)) {
            const path = join(folder, `${id}.${extension}`);
            const info = await stat(path).catch(() => null);
            if (info?.isFile()) {
                return { id, name: `${id}.${extension}`, mime, size: info.size, path };
            }
        }
        return null;
    }

    /* Gives a fork the same images under the same ids, so the blocks it copied still show them. */
    async copy(fromChatId: string, toChatId: string): Promise<void> {
        const names = await this.names(this.attachments.folderOf(fromChatId));
        if (names.length === 0) {
            return;
        }
        const target = this.attachments.folderOf(toChatId);
        await mkdir(target, { recursive: true, mode: 0o700 });
        await Promise.all(names.map((name) => copyFile(join(this.attachments.folderOf(fromChatId), name), join(target, name))));
    }

    private async names(folder: string): Promise<string[]> {
        const entries = await readdir(folder).catch(() => []);
        return entries.filter((name) => ID.test(name.slice(0, name.lastIndexOf('.'))));
    }
}
