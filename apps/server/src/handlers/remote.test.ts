import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeWatch } from '@adecore/agents/testing';
import type { ServerFrame } from '@ruimte/contracts';
import { Dispatcher } from '../dispatcher.ts';
import { projectLinks } from '../projects/project-file-test-helpers.ts';
import { ProjectStore } from '../projects/project-store.ts';
import { PendingAdmissions } from '../remote/pending-admissions.ts';
import { registerRemoteHandlers } from './remote.ts';

let root: string;
let store: ProjectStore;
let dispatcher: Dispatcher;
let projectId: string;
let pending: PendingAdmissions;

const PEER_KEY = 'P'.repeat(43);

function statementFor(patch: Record<string, unknown> = {}): Record<string, unknown> {
    const issuedAt = Date.now();
    return {
        machineId: 'machine-b',
        machinePublicKey: 'B'.repeat(43),
        accountId: 'account-1',
        peerPublicKey: PEER_KEY,
        peerMachineId: 'machine-a',
        peerMachinePublicKey: 'A'.repeat(43),
        nonce: 'n'.repeat(22),
        issuedAt,
        expiresAt: issuedAt + 600_000,
        signature: 's'.repeat(86),
        ...patch
    };
}

const LINK = { machineId: 'machine-b', remoteProjectId: 'remote-1', label: 'MacBook Pro', rootCommit: 'abc123' };

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-remote-handlers-'));
    const folder = join(root, 'repo');
    await mkdir(folder);
    store = new ProjectStore(join(root, 'home'), projectLinks(), new FakeWatch());
    dispatcher = new Dispatcher();
    pending = new PendingAdmissions();
    registerRemoteHandlers(dispatcher, store.remote, store, { machineId: 'machine-a', peerPublicKey: async () => PEER_KEY, pending });
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

describe('the checkout a project is linked to on another machine', () => {
    test('is remembered per machine, replaced by a new link and listed', async () => {
        expect(await ask('remote.list', { projectId })).toMatchObject({ ok: true, result: { links: [] } });
        expect(await ask('remote.link', { projectId, ...LINK })).toMatchObject({ ok: true, result: LINK });
        await ask('remote.link', { projectId, ...LINK, remoteProjectId: 'remote-2' });
        await ask('remote.link', { projectId, ...LINK, machineId: 'machine-c', label: 'Mac mini' });
        expect(await ask('remote.list', { projectId })).toMatchObject({
            result: { links: [{ machineId: 'machine-b', remoteProjectId: 'remote-2' }, { machineId: 'machine-c' }] }
        });
    });

    test('survives a restart', async () => {
        await ask('remote.link', { projectId, ...LINK });
        const fresh = new ProjectStore(join(root, 'home'), projectLinks(), new FakeWatch());
        await fresh.remote.load();
        expect(fresh.remote.linksOf(projectId)).toEqual([LINK]);
    });

    test('is refused for a project that is not here', async () => {
        expect(await ask('remote.link', { projectId: 'nowhere', ...LINK })).toMatchObject({ ok: false, error: { code: 'project-not-found' } });
        expect(await ask('remote.list', { projectId: 'nowhere' })).toMatchObject({ ok: false, error: { code: 'project-not-found' } });
    });

    test('is removed with unlink, unless a node still runs on that machine', async () => {
        await ask('remote.link', { projectId, ...LINK });
        const node = { id: 'n1', kind: 'terminal' as const, title: 'shell', x: 0, y: 0, w: 560, h: 360, machine: 'machine-b' };
        await store.save(projectId, 0, {
            name: 'repo',
            color: '#123456',
            views: [{ kind: 'canvas', id: 'main', name: 'Canvas', nodes: [node], texts: [], edges: [], layouts: [] }]
        });
        expect(await ask('remote.unlink', { projectId, machineId: 'machine-b' })).toMatchObject({ ok: false, error: { code: 'machine-in-use' } });
        expect(store.remote.linksOf(projectId)).toHaveLength(1);

        await store.save(projectId, 1, { name: 'repo', color: '#123456', views: [] });
        expect(await ask('remote.unlink', { projectId, machineId: 'machine-b' })).toMatchObject({ ok: true });
        expect(store.remote.linksOf(projectId)).toEqual([]);
    });
});

describe('a peer statement handed over for another machine', () => {
    test('is held until that machine lets this one in', async () => {
        expect(await ask('remote.connect', { machineId: 'machine-b', statement: statementFor() })).toMatchObject({ ok: true });
        expect(pending.peek('machine-b')).toMatchObject({ machineId: 'machine-b', peerMachineId: 'machine-a' });
    });

    test('is refused when it names another machine, another peer key, or has run out', async () => {
        const cases = [{ machineId: 'machine-c' }, { peerMachineId: 'machine-z' }, { peerPublicKey: 'Q'.repeat(43) }, { issuedAt: 1, expiresAt: 2 }];
        for (const patch of cases) {
            const machineId = 'machine-b';
            expect(await ask('remote.connect', { machineId, statement: statementFor(patch) })).toMatchObject({ ok: false, error: { code: 'bad-statement' } });
        }
        expect(pending.peek('machine-b')).toBeNull();
    });
});
