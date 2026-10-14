import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ACTION_DEFINITIONS } from '@ruimte/actions';
import type { ProjectContent } from '@ruimte/contracts';
import { ManualClock } from '@adecore/agents/testing';
import { ProjectStore } from '../projects/project-store.ts';
import { projectLinks } from '../projects/project-file-test-helpers.ts';
import { bootTestDaemon, runVerb, type TestDaemon } from '../tasks/test-daemon.ts';
import { AGENT_IMAGE_LIMIT } from './agent-images.ts';

function content(): ProjectContent {
    return {
        name: 'repo',
        color: '#123456',
        views: [
            {
                kind: 'canvas',
                id: 'main',
                name: 'Canvas',
                nodes: [
                    { id: 'chat-lead', kind: 'chat', title: 'Lead', x: 0, y: 0, w: 560, h: 640, provider: 'claude' },
                    { id: 'term-lead', kind: 'terminal', title: 'Shell', x: 0, y: 700, w: 560, h: 360 }
                ],
                texts: [],
                edges: [],
                layouts: []
            }
        ]
    };
}

const MIB = 1024 * 1024;

/* Just enough of a PNG for its bytes to read as one. */
const PNG = Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), Buffer.from([0, 0, 0, 13]), Buffer.from('IHDR'), Buffer.alloc(17)]);

let root: string;
let home: string;
let folder: string;
let store: ProjectStore;
let running: TestDaemon[];

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-agent-images-'));
    home = join(root, 'home');
    folder = join(root, 'repo');
    await mkdir(folder, { recursive: true });
    store = new ProjectStore(home, projectLinks());
    const opened = await store.openProject({ folder });
    await store.save(opened.summary.projectId, opened.document.rev, content());
    store.release(opened.summary.projectId);
    running = [];
});

afterEach(async () => {
    for (const daemon of running) {
        await daemon.stop();
    }
    store.closeAll();
    await rm(root, { recursive: true, force: true });
});

async function bootWithChat(): Promise<TestDaemon> {
    const daemon = await bootTestDaemon({
        home,
        store,
        clock: new ManualClock(),
        installed: ['claude'],
        machine: { resumeAtReset: false, visualReplies: true }
    });
    running.push(daemon);
    daemon.worker.start();
    await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder });
    return daemon;
}

function attach(daemon: TestDaemon, caller: string, bytes: Uint8Array, name = 'shot.png'): Promise<string[]> {
    return runVerb(daemon, caller, 'chat', ['attach', '--name', name, `--data=${Buffer.from(bytes).toString('base64')}`]);
}

function refusalCode(lines: string[]): string | undefined {
    return lines[0]!.startsWith('refused\t') ? lines[0]!.split('\t')[1] : undefined;
}

describe('chat attach', () => {
    test('stores an image under an agent id and prints it, and the attachment lookup answers it', async () => {
        const daemon = await bootWithChat();
        const lines = await attach(daemon, 'chat-lead', PNG);
        const [kind, id, name, mime, size] = lines[0]!.split('\t');
        expect([kind, name, mime, size]).toEqual(['attachment', 'shot.png', 'image/png', String(PNG.byteLength)]);
        expect(id).toMatch(/^agent-[0-9a-f-]{36}$/);
        expect(lines[1]).toBe(`next\tShow it with <Image attachment="${id}" alt="..."/> in a ruimte-ui block`);

        const found = await daemon.chats.findAttachment('chat-lead', id!);
        expect(found).toMatchObject({ id, name: 'shot.png', mime: 'image/png', size: PNG.byteLength });
        expect(found!.path).toStartWith(join(home, 'attachments', 'chat-lead', `${id}~`));
        expect(await readFile(found!.path)).toEqual(PNG);
    });

    test('takes the type from the bytes, so text and a vector image are refused and a renamed gif is a gif', async () => {
        const daemon = await bootWithChat();
        expect(refusalCode(await attach(daemon, 'chat-lead', Buffer.from('a list of things to do\n'), 'shot.png'))).toBe('attach-not-image');
        const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>');
        expect(refusalCode(await attach(daemon, 'chat-lead', svg, 'logo.png'))).toBe('attach-not-image');
        const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(16)]);
        expect((await attach(daemon, 'chat-lead', gif, 'looks-like.png'))[0]).toContain('\timage/gif\t');
    });

    test('refuses an image past the size limit, and the 65th image of a chat', async () => {
        const daemon = await bootWithChat();
        const large = Buffer.concat([PNG, Buffer.alloc(10 * MIB)]);
        expect(refusalCode(await attach(daemon, 'chat-lead', large))).toBe('attach-too-large');
        for (let i = 0; i < AGENT_IMAGE_LIMIT; i++) {
            expect((await attach(daemon, 'chat-lead', PNG))[0]).toStartWith('attachment\t');
        }
        const lines = await attach(daemon, 'chat-lead', PNG);
        expect(refusalCode(lines)).toBe('attach-limit');
        expect(lines[0]).toContain(`${AGENT_IMAGE_LIMIT} images`);
    });

    test('attaches sent at once cannot pass the limit together', async () => {
        const daemon = await bootWithChat();
        const results = await Promise.all(Array.from({ length: AGENT_IMAGE_LIMIT + 6 }, () => attach(daemon, 'chat-lead', PNG)));
        expect(results.filter((lines) => lines[0]!.startsWith('attachment\t'))).toHaveLength(AGENT_IMAGE_LIMIT);
        expect(results.filter((lines) => refusalCode(lines) === 'attach-limit')).toHaveLength(6);
        expect((await readdir(join(home, 'attachments', 'chat-lead'))).filter((name) => name.startsWith('agent-'))).toHaveLength(AGENT_IMAGE_LIMIT);
    });

    test('a terminal is told an image attaches only to an AI chat, and nothing is stored', async () => {
        const daemon = await bootWithChat();
        const lines = await attach(daemon, 'term-lead', PNG);
        expect(lines[0]).toStartWith('refused\tattach-needs-chat\t');
        expect(lines[0]).toContain('you are a terminal');
        expect(await stat(join(home, 'attachments', 'term-lead')).catch(() => null)).toBeNull();
    });

    test('a call without the bytes the CLI reads is refused with the way to run it', async () => {
        const daemon = await bootWithChat();
        const lines = await runVerb(daemon, 'chat-lead', 'chat', ['attach', '--file', '/etc/hosts']);
        expect(refusalCode(lines)).toBe('bad-arguments');
        expect(lines).toContain('detail\truimte-context help chat attach');
    });

    test('the action takes no path: only a name and the bytes', () => {
        expect(Object.keys(ACTION_DEFINITIONS['chat.attach'].input.shape)).toEqual(['name', 'data']);
    });
});

describe('finding an agent image', () => {
    test('answers only the exact ids of this chat, never a path or another chat', async () => {
        const daemon = await bootWithChat();
        const [, id] = (await attach(daemon, 'chat-lead', PNG))[0]!.split('\t');
        expect(await daemon.chats.findAttachment('chat-lead', id!)).not.toBeNull();
        expect(await daemon.chats.findAttachment('other-chat', id!)).toBeNull();
        for (const bad of [`${id}.png`, `../${id}`, 'agent-', 'agent-../../x', '']) {
            expect(await daemon.chats.findAttachment('chat-lead', bad)).toBeNull();
        }
    });

    test('keeps the name the agent gave, however odd, and cuts one too long to be a file name', async () => {
        const daemon = await bootWithChat();
        const names = ['Home screen (dark).png', 'a/b\\c ~ d?.png', 'häuser-🏠.png', 'x'.repeat(190), 'tab\tand\nnewline.png'];
        for (const name of names) {
            const [, id, kept] = (await attach(daemon, 'chat-lead', PNG, name))[0]!.split('\t');
            const found = await daemon.chats.findAttachment('chat-lead', id!);
            expect(found!.name).toBe(kept!);
            expect(found!.name).toBe(name.length > 150 ? name.slice(0, found!.name.length) : name.replaceAll(/[\t\n]/g, ''));
            expect(Buffer.byteLength(found!.path.split('/').pop()!)).toBeLessThan(255);
        }
    });

    test('a fork gets the same images under the same ids, and the original keeps its own', async () => {
        const daemon = await bootWithChat();
        const [, id] = (await attach(daemon, 'chat-lead', PNG))[0]!.split('\t');
        await daemon.chats.copyAgentImages('chat-lead', 'chat-fork');
        const copy = await daemon.chats.findAttachment('chat-fork', id!);
        expect(copy).toMatchObject({ id, name: 'shot.png', size: PNG.byteLength });
        expect(copy!.path).toStartWith(join(home, 'attachments', 'chat-fork', `${id}~`));
        expect(await daemon.chats.findAttachment('chat-lead', id!)).not.toBeNull();
        // A link in the folder is not an image of the chat: it is neither found nor copied.
        const outside = join(root, 'secret.png');
        await writeFile(outside, PNG);
        const linked = 'agent-00000000-0000-4000-8000-000000000000';
        await symlink(outside, join(home, 'attachments', 'chat-lead', `${linked}.png`));
        expect(await daemon.chats.findAttachment('chat-lead', linked)).toBeNull();
        await daemon.chats.copyAgentImages('chat-lead', 'chat-fork-2');
        expect(await readdir(join(home, 'attachments', 'chat-fork-2'))).toEqual([
            (await daemon.chats.findAttachment('chat-lead', id!))!.path.split('/').pop()!
        ]);
        // Nothing to copy leaves no folder behind.
        await daemon.chats.copyAgentImages('chat-without-images', 'chat-empty');
        expect(await stat(join(home, 'attachments', 'chat-empty')).catch(() => null)).toBeNull();
    });
});
