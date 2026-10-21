import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerFrame } from '@ruimte/contracts';
import { Dispatcher, type ClientAccess } from '../dispatcher.ts';
import { sha256, zip } from '../language/test-archives.ts';
import { AcpServerInstall, parseAcpServerRelease } from '../providers/acp-server.ts';
import { registerAgentServerHandlers } from './agent-servers.ts';

const ARCHIVE = zip([{ path: 'agy_acp_server.par', text: 'server' }]);

let home: string;
let dispatcher: Dispatcher;
let frames: ServerFrame[];
let downloads: number;
let invalidated: string[];

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-agent-servers-'));
    downloads = 0;
    invalidated = [];
    const server = new AcpServerInstall({
        provider: 'antigravity',
        home,
        release: parseAcpServerRelease({
            version: '1.4.1',
            assets: { 'linux-x64': { url: 'https://example.test/s.zip', sha256: sha256(ARCHIVE), format: 'zip', executable: 'agy_acp_server.par', args: [] } }
        }),
        platform: 'linux',
        arch: 'x64',
        download: async (_url, destination) => {
            downloads++;
            await writeFile(destination, ARCHIVE);
        }
    });
    dispatcher = new Dispatcher();
    registerAgentServerHandlers(dispatcher, { of: (kind) => (kind === 'antigravity' ? server : undefined), installed: (kind) => invalidated.push(kind) });
    frames = [];
});

afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

const OWNER: ClientAccess = { reachability: 'loopback', sessionId: null };
const GUEST: ClientAccess = { reachability: 'lan', sessionId: 'session-1' };

async function call(type: string, payload: unknown, access: ClientAccess): Promise<ServerFrame> {
    await dispatcher.handle({ id: 'client-1', access, send: (frame) => frames.push(frame) }, JSON.stringify({ id: 'r1', type, payload }));
    return frames.at(-1) as ServerFrame;
}

describe('agent server handlers', () => {
    test('any client sees where the server stands, and only the local secret installs it', async () => {
        expect(await call('provider.server', { provider: 'antigravity' }, GUEST)).toMatchObject({ ok: true, result: { server: { state: 'missing' } } });
        expect(await call('provider.installServer', { provider: 'antigravity' }, GUEST)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
        expect(downloads).toBe(0);

        expect(await call('provider.installServer', { provider: 'antigravity' }, OWNER)).toMatchObject({
            ok: true,
            result: { server: { state: 'installed', installed: '1.4.1' } }
        });
        expect(invalidated).toEqual(['antigravity']);
    });

    test('a CLI without a server of its own is refused', async () => {
        expect(await call('provider.installServer', { provider: 'claude' }, OWNER)).toMatchObject({ ok: false, error: { code: 'no-agent-server' } });
    });
});
