import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeWatch } from '@adecore/agents/testing';
import type { ProjectContent, ServerFrame } from '@ruimte/contracts';
import { Dispatcher } from '../dispatcher.ts';
import { peerCanvasId } from '../peering/links.ts';
import { projectLinks } from '../projects/project-file-test-helpers.ts';
import { ProjectStore } from '../projects/project-store.ts';
import { registerPeerHandlers } from './peer.ts';

let root: string;
let store: ProjectStore;
let dispatcher: Dispatcher;
let ended: string[];
let heard: string[];
let projectId: string;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-peer-handlers-'));
    const folder = join(root, 'repo');
    await mkdir(folder);
    ended = [];
    heard = [];
    store = new ProjectStore(join(root, 'home'), projectLinks({ endSession: async (kind, nodeId) => void ended.push(`${kind}:${nodeId}`) }), new FakeWatch());
    store.peers.subscribe('c1', (event) => void heard.push(event.event));
    dispatcher = new Dispatcher();
    registerPeerHandlers(dispatcher, {
        links: store.peers,
        projects: store,
        endSession: async (kind, nodeId) => void ended.push(`${kind}:${nodeId}`),
        worktreePaths: async () => []
    });
    projectId = (await store.openProject({ folder })).summary.projectId;
});

afterEach(async () => {
    store.closeAll();
    await rm(root, { recursive: true, force: true });
});

async function ask(type: string, payload: unknown): Promise<ServerFrame> {
    const frames: ServerFrame[] = [];
    await dispatcher.handle({ id: 'phone', send: (frame) => frames.push(frame) }, JSON.stringify({ id: 'request', type, payload }));
    return frames[0]!;
}

function withPeerCanvas(): ProjectContent {
    return {
        name: 'repo',
        color: '#123456',
        views: [
            {
                kind: 'canvas',
                id: 'main',
                name: 'Canvas',
                nodes: [{ id: 'own', kind: 'terminal', title: 'shell', x: 0, y: 0, w: 560, h: 360 }],
                texts: [],
                edges: [],
                layouts: []
            },
            {
                kind: 'canvas',
                id: peerCanvasId('machine-a'),
                name: 'MacBook Pro',
                nodes: [
                    { id: 'remote-term', kind: 'terminal', title: 'shell', x: 0, y: 0, w: 560, h: 360 },
                    { id: 'remote-chat', kind: 'chat', title: 'chat', x: 600, y: 0, w: 560, h: 360 },
                    { id: 'remote-note', kind: 'note', title: 'note', x: 0, y: 400, w: 320, h: 240, body: 'x' }
                ],
                texts: [],
                edges: [],
                layouts: []
            }
        ]
    };
}

describe('linking a project to another machine', () => {
    test('a new link is supervised, listed with the name of its project, and announced', async () => {
        expect(await ask('peer.bind', { machineId: 'machine-a', label: 'MacBook Pro', projectId })).toMatchObject({
            ok: true,
            result: { machineId: 'machine-a', projectId, projectName: 'repo', ceiling: 'supervised' }
        });
        expect(await ask('peer.list', {})).toMatchObject({
            ok: true,
            result: { links: [{ machineId: 'machine-a', label: 'MacBook Pro', projectName: 'repo' }] }
        });
        expect(heard).toEqual(['peer.changed']);
    });

    test('a ceiling is kept, changed on request, and a link of nobody has none to change', async () => {
        await ask('peer.bind', { machineId: 'machine-a', label: 'MacBook Pro', projectId, ceiling: 'auto' });
        expect(await ask('peer.setCeiling', { machineId: 'machine-a', projectId, ceiling: 'supervised' })).toMatchObject({ ok: true });
        expect(await ask('peer.list', {})).toMatchObject({ result: { links: [{ ceiling: 'supervised' }] } });
        expect(await ask('peer.setCeiling', { machineId: 'machine-z', projectId, ceiling: 'auto' })).toMatchObject({
            ok: false,
            error: { code: 'peer-not-linked' }
        });
    });

    test('a project that is not on this machine cannot be linked', async () => {
        expect(await ask('peer.bind', { machineId: 'machine-a', label: 'MacBook Pro', projectId: 'nowhere' })).toMatchObject({
            ok: false,
            error: { code: 'project-not-found' }
        });
        expect(await ask('peer.list', {})).toMatchObject({ result: { links: [] } });
    });

    test('is persisted, and a restarted machine hides the canvas of the linked machine again', async () => {
        await store.save(projectId, 0, withPeerCanvas());
        await ask('peer.bind', { machineId: 'machine-a', label: 'MacBook Pro', projectId });
        expect(store.peers.canvasIdsOf(projectId)).toEqual(new Set([peerCanvasId('machine-a')]));

        const fresh = new ProjectStore(join(root, 'home'), projectLinks(), new FakeWatch());
        await fresh.peers.load();
        const document = (await fresh.openProject({ projectId })).document;
        expect(document.views.map((view) => [view.id, 'hidden' in view ? view.hidden : undefined])).toEqual([
            ['main', undefined],
            [peerCanvasId('machine-a'), true]
        ]);
        fresh.closeAll();
    });
});

describe('unlinking a project', () => {
    test('ends the sessions and chats of the machine, removes its canvas, and leaves the rest', async () => {
        await store.save(projectId, 0, withPeerCanvas());
        await ask('peer.bind', { machineId: 'machine-a', label: 'MacBook Pro', projectId });

        expect(await ask('peer.unbind', { machineId: 'machine-a', projectId })).toMatchObject({ ok: true });
        expect(ended).toEqual(['terminal:remote-term', 'chat:remote-chat']);
        expect((await store.read(projectId)).views.map((view) => view.id)).toEqual(['main']);
        expect(await ask('peer.list', {})).toMatchObject({ result: { links: [] } });
        expect(await ask('peer.unbind', { machineId: 'machine-a', projectId })).toMatchObject({ ok: false, error: { code: 'peer-not-linked' } });
    });
});

describe('the canvas of a linked machine', () => {
    test('is not listed, not openable, and cannot be shared', async () => {
        await store.save(projectId, 0, withPeerCanvas());
        await ask('peer.bind', { machineId: 'machine-a', label: 'MacBook Pro', projectId });
        const sidebar = await store.sidebar();
        expect(sidebar.projects[0]?.views?.map((view) => view.id)).toEqual(['main']);
        const content = await store.read(projectId);
        await expect(store.save(projectId, await store.revision(projectId), content, [peerCanvasId('machine-a')])).rejects.toMatchObject({
            code: 'hidden-view-shared'
        });
    });
});

describe('the nodes another machine draws here', () => {
    const TERM = { id: 'remote-term', kind: 'terminal' as const, title: 'shell' };
    const CHAT = { id: 'remote-chat', kind: 'chat' as const, title: 'chat' };

    async function linked(): Promise<void> {
        await ask('peer.bind', { machineId: 'machine-a', label: 'MacBook Pro', projectId });
    }

    const place = (nodes: unknown[], edges: unknown[] = [], extra: Record<string, unknown> = {}) =>
        ask('peer.placeNodes', { machineId: 'machine-a', projectId, nodes, edges, ...extra });

    test('goes on a canvas of its own that is hidden and private, with the ids it came with', async () => {
        await linked();
        expect(await place([TERM, CHAT], [{ id: 'e1', from: 'remote-chat', to: 'remote-term', role: 'target' }])).toMatchObject({ ok: true });
        const canvas = (await store.read(projectId)).views.find((view) => view.id === peerCanvasId('machine-a'));
        expect(canvas).toMatchObject({
            kind: 'canvas',
            name: 'MacBook Pro',
            hidden: true,
            nodes: [{ id: 'remote-term' }, { id: 'remote-chat' }],
            edges: [{ id: 'e1' }]
        });
        expect((await store.sidebar()).projects[0]?.views).toEqual([]);
        expect(await store.openProject({ projectId }).then((opened) => opened.document.shared)).toEqual([]);
    });

    test('twice is the same as once', async () => {
        await linked();
        await place([TERM, CHAT]);
        const rev = await store.revision(projectId);
        await place([TERM, CHAT]);
        expect(await store.revision(projectId)).toBe(rev);
    });

    test('ends the session of a node the other machine no longer draws, before the canvas drops it', async () => {
        await linked();
        await place([TERM, CHAT]);
        ended.length = 0;
        await place([TERM]);
        expect(ended).toEqual(['chat:remote-chat']);
        const canvas = (await store.read(projectId)).views.find((view) => view.id === peerCanvasId('machine-a'));
        expect(canvas).toMatchObject({ nodes: [{ id: 'remote-term' }] });
    });

    test('refuses a line with an end that is not among the nodes', async () => {
        await linked();
        expect(await place([TERM], [{ id: 'e1', from: 'remote-term', to: 'on-the-other-machine' }])).toMatchObject({
            ok: false,
            error: { code: 'edge-off-machine' }
        });
    });

    test('refuses a machine without a link, and a folder beyond the project', async () => {
        expect(await place([TERM])).toMatchObject({ ok: false, error: { code: 'peer-not-linked' } });
        await linked();
        expect(await place([{ ...TERM, cwd: tmpdir() }])).toMatchObject({ ok: false, error: { code: 'cwd-outside' } });
        expect(await place([{ ...TERM, cwd: join(root, 'repo') }])).toMatchObject({ ok: true });
    });

    test('lets the asking client hold the project, so that closing it as the last holder ends the sessions', async () => {
        await linked();
        const frames: ServerFrame[] = [];
        await dispatcher.handle(
            { id: 'window', send: (frame) => frames.push(frame) },
            JSON.stringify({ id: 'place', type: 'peer.placeNodes', payload: { machineId: 'machine-a', projectId, nodes: [TERM, CHAT], edges: [] } })
        );
        expect(store.holdersOf(projectId)).toEqual(['window']);
        ended.length = 0;
        await store.closeProject(projectId, 'window');
        expect(ended.sort()).toEqual(['chat:remote-chat', 'terminal:remote-term']);
    });
});
