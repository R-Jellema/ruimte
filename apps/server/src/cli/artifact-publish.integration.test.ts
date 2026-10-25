import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'bun';
import { ArtifactStore } from '../artifacts/artifact-store.ts';
import { Artifacts } from '../artifacts/artifacts.ts';
import { ARTIFACT_UPLOAD_PATH, handleArtifactUpload } from '../canvas/artifact-upload-route.ts';
import { handleCanvasRequest } from '../canvas/canvas-route.ts';
import type { CanvasHost } from '../canvas/verb.ts';
import { prepareArtifactPublish } from './artifact-publish.ts';

const MIB = 1024 * 1024;

let base: string;
let server: Server<undefined>;
let artifacts: Artifacts;
let store: ArtifactStore;
const headers = { authorization: 'Bearer token-1' };

beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'ruimte-artifact-cli-'));
    store = new ArtifactStore({ root: join(base, 'artifacts') });
    await store.load();
    artifacts = new Artifacts({
        store,
        home: base,
        machineId: 'machine-1',
        projects: { known: async () => [{ projectId: 'p1', name: 'One', folder: base }], projectOf: (id) => (id === 'chat-1' ? 'p1' : null) },
        chats: { findAttachment: async () => null, hasStored: async () => true },
        machineHome: { refuse: async () => undefined },
        provenanceOf: async (caller) => ({ maker: 'agent', machineId: 'machine-1', chatId: caller, nodeId: caller })
    });
    const host = { projects: { locate: () => ({ projectId: 'p1', folder: base, canvasId: 'main' }) }, artifacts } as unknown as CanvasHost;
    const targetForToken = (token: string): string | null => (token === 'token-1' ? 'chat-1' : null);
    server = Bun.serve({
        port: 0,
        hostname: '127.0.0.1',
        fetch: (request) => {
            const url = new URL(request.url);
            if (url.pathname.startsWith(`${ARTIFACT_UPLOAD_PATH}/`)) {
                return handleArtifactUpload(request, url, { targetForToken, artifacts });
            }
            return handleCanvasRequest(request, url.pathname, { targetForToken, host });
        }
    });
});

afterEach(async () => {
    await server.stop(true);
    await rm(base, { recursive: true, force: true });
});

async function publish(argv: string[]): Promise<string> {
    const canvasUrl = `http://127.0.0.1:${server.port}/canvas`;
    const prepared = await prepareArtifactPublish(canvasUrl, argv, headers);
    if (!('argv' in prepared)) {
        throw new Error(JSON.stringify(prepared));
    }
    const response = await fetch(`${canvasUrl}/artifact`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ argv: ['publish', ...prepared.argv] })
    });
    return response.text();
}

test('an interrupted publish goes on where it stopped, and a retry after it landed sends nothing again', async () => {
    const bytes = new Uint8Array(9 * MIB).map((_value, i) => i % 251);
    const file = join(base, 'build.bin');
    await writeFile(file, bytes);
    // What a run that died after its first piece left on the machine.
    await artifacts.uploadAppend('chat-1', 'run-1', 0, 0, bytes.subarray(0, 3 * MIB));

    const printed = await publish(['--file', file, '--request-id', 'run-1', '--title', 'Nightly']);
    expect(printed).toMatch(/^artifact\tart-\w+\tver-\w+\t1\tbuild\tNightly\t1\t9437184\n/);
    const [summary] = store.list();
    const stored = await readFile(store.file(summary!.artifactId, summary!.latest.versionId, 0)!.path);
    expect(Buffer.compare(stored, Buffer.from(bytes))).toBe(0);

    const again = await publish(['--file', file, '--request-id', 'run-1']);
    expect(again).toContain('An earlier call with this request id saved this version');
    expect(store.list()).toHaveLength(1);
});

test('a publish without a request id makes one, and a missing file is refused before anything is sent', async () => {
    await writeFile(join(base, 'notes.md'), '# Notes');
    expect(await publish(['--file', join(base, 'notes.md')])).toMatch(/\treport\tnotes\t1\t7\n/);
    const refused = await prepareArtifactPublish(`http://127.0.0.1:${server.port}/canvas`, ['--file', join(base, 'gone.md')], headers);
    expect(refused).toMatchObject({ refusal: { code: 'unreadable' } });
});
