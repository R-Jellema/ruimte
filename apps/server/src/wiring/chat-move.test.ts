import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManualClock } from '@adecore/agents/testing';
import { newScratchChat } from '../projects/scratch-project.ts';
import { ProjectStore } from '../projects/project-store.ts';
import { projectLinks } from '../projects/project-file-test-helpers.ts';
import { bootTestDaemon, type TestDaemon } from '../tasks/test-daemon.ts';
import { MachineHome } from '../fs/machine-home.ts';
import { chatMoveHandlers } from './chat-move.ts';

describe('what the machine says about moving a chat', () => {
    let root: string;
    let store: ProjectStore;
    let daemon: TestDaemon;
    let chatId: string;

    const moves = () =>
        chatMoveHandlers({
            ...daemon,
            store,
            lineage: daemon.lineage,
            prWatches: daemon.prWatches,
            outbox: daemon.outbox,
            machineHome: new MachineHome(store.home)
        });

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

    test('lists no folder for an id that climbs out of the scratch folder', async () => {
        for (const id of ['..', '../..', '../../../../etc']) {
            const info = await moves().info({ chatId: id });
            expect(info).toMatchObject({ refusal: { reason: 'not-in-chats' }, folders: [], ownFiles: { folder: '', count: 0, names: [] }, conflicts: [] });
        }
    });

    test("refuses to look into a folder that holds the machine's own state, and allows a project folder", async () => {
        const state = join(store.home, 'chats');
        await mkdir(state, { recursive: true });
        const into = (folder: string) => ({ chatId, to: { folder, name: 'X', createFolder: false, initGit: false } });
        await expect(moves().info(into(state))).rejects.toMatchObject({ code: 'machine-state' });
        const project = join(root, 'vinyl');
        await mkdir(project);
        await writeFile(join(project, 'notes.md'), 'y');
        expect((await moves().info(into(project))).conflicts).toEqual(['notes.md']);
    });

    test('refuses a chat that opened an agent', async () => {
        await daemon.lineage.put({ projectId: 'p1', nodeId: 'child', openedBy: chatId, depth: 1, agent: true });
        expect((await moves().info({ chatId })).refusal).toEqual({ reason: 'agents' });
    });

    test('refuses a chat whose status is idle while work goes on', async () => {
        const session = daemon.chats.get(chatId)!;
        const patches = [
            { delegating: true },
            { background: [{ id: 'b1', kind: 'shell', label: 'dev server' }] },
            { goal: { objective: 'ship', status: 'active' } },
            { requests: [{ id: 'r1', kind: 'question' }] },
            { queue: [{ id: 'q1', text: 'later' }] }
        ];
        for (const patch of patches) {
            session.thread.patchInfo(patch as never);
            expect((await moves().info({ chatId })).refusal).toEqual({ reason: 'working' });
            session.thread.patchInfo({ delegating: false, background: [], goal: undefined, requests: [], queue: [] } as never);
        }
        expect((await moves().info({ chatId })).refusal).toBeNull();
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
