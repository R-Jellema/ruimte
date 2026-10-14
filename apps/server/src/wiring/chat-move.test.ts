import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManualClock } from '@adecore/agents/testing';
import { newScratchChat } from '../projects/scratch-project.ts';
import { ProjectStore } from '../projects/project-store.ts';
import { projectLinks } from '../projects/project-file-test-helpers.ts';
import { bootTestDaemon, type TestDaemon } from '../tasks/test-daemon.ts';
import { chatMoveHandlers } from './chat-move.ts';

describe('what the machine says about moving a chat', () => {
    let root: string;
    let store: ProjectStore;
    let daemon: TestDaemon;
    let chatId: string;

    const moves = () => chatMoveHandlers({ ...daemon, store, lineage: daemon.lineage, prWatches: daemon.prWatches, outbox: daemon.outbox });

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), 'ruimte-move-info-'));
        const home = join(root, 'home');
        store = new ProjectStore(home, projectLinks());
        daemon = await bootTestDaemon({ home, store, clock: new ManualClock() });
        chatId = (await newScratchChat(store, {})).viewId;
        await daemon.chats.create({ chatId, provider: 'claude', cwd: join(store.scratchFolder, chatId) });
        await writeFile(join(store.scratchFolder, chatId, 'notes.md'), 'x');
    });

    afterEach(async () => {
        await daemon.stop();
        store.closeAll();
        await rm(root, { recursive: true, force: true });
    });

    test('lists the own files of a quiet chat in Chats and refuses nothing', async () => {
        const info = await moves().info({ chatId });
        expect(info.ownFiles).toEqual({ folder: join(store.scratchFolder, chatId), count: 1, names: ['notes.md'] });
        expect(info.refusal).toBeNull();
        expect(info.newFolderParent).not.toBe('');
    });

    test('refuses a chat that opened an agent', async () => {
        await daemon.lineage.put({ projectId: 'p1', nodeId: 'child', openedBy: chatId, depth: 1, agent: true });
        expect((await moves().info({ chatId })).refusal).toEqual({ reason: 'agents' });
    });

    test('refuses a chat that is not a view of Chats', async () => {
        const folder = join(root, 'repo');
        await mkdir(folder);
        const opened = await store.openProject({ folder });
        await store.mutate(opened.summary.projectId, (content) => ({
            content: { ...content, views: [...content.views, { kind: 'chat', id: 'chat-elsewhere', name: 'Elsewhere', node: {} }] },
            result: undefined
        }));
        expect((await moves().info({ chatId: 'chat-elsewhere' })).refusal).toEqual({ reason: 'not-in-chats' });
    });

    test('refuses a chat that waits on a person', async () => {
        await daemon.chats.send(chatId, 'ask: which color');
        await daemon.until(() => daemon.chats.get(chatId)?.info.status === 'needs-you');
        expect((await moves().info({ chatId })).refusal).toEqual({ reason: 'working' });
    });
});
