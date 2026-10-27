import { join } from 'node:path';
import type { Subprocess } from 'bun';
import type { ProjectContent } from '@ruimte/contracts';

/** A project whose canvas holds one Claude chat, `chat-lead`, that hands work to another machine. */
export function leadContent(): ProjectContent {
    return {
        name: 'repo',
        color: '#123456',
        views: [
            {
                kind: 'canvas',
                id: 'main',
                name: 'Canvas',
                nodes: [{ id: 'chat-lead', kind: 'chat', title: 'Lead', x: 0, y: 0, w: 560, h: 640, provider: 'claude' }],
                texts: [],
                edges: [],
                layouts: []
            }
        ]
    };
}

export async function freePort(): Promise<number> {
    const server = Bun.serve({ port: 0, fetch: () => new Response('') });
    const { port } = server;
    await server.stop(true);
    return port!;
}

export async function waitFor(label: string, ready: () => boolean | Promise<boolean>, timeoutMs = 15_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!(await ready())) {
        if (Date.now() > deadline) {
            throw new Error(`Timed out waiting for ${label}`);
        }
        await Bun.sleep(50);
    }
}

/** A real broker in a process of its own, on a free port. */
export async function startBroker(): Promise<{ broker: Subprocess; port: number; url: string }> {
    const port = await freePort();
    const broker = Bun.spawn(['bun', join(import.meta.dir, '..', '..', '..', 'pulsar-broker', 'src', 'main.ts'), '--port', String(port)], {
        stdout: 'ignore',
        stderr: 'inherit'
    });
    await waitFor('the broker to answer', async () => (await fetch(`http://127.0.0.1:${port}/health`).catch(() => null))?.ok === true);
    return { broker, port, url: `ws://127.0.0.1:${port}` };
}
