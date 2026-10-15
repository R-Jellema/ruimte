import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ClientConnection } from '../dispatcher.ts';
import { PeerLinks } from './links.ts';
import { requirePeerLinks } from './peer-access.ts';

let home: string;
let links: PeerLinks;

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-peer-access-'));
    links = new PeerLinks(home);
    await links.load();
});

afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

function peer(machineId: string): ClientConnection {
    return { id: 'c1', access: { reachability: 'lan', sessionId: 's1', peer: { machineId } }, send: () => undefined };
}

describe('the links of a peer', () => {
    test('a peer without a link gets peer-not-linked, whatever other machines are linked', async () => {
        await links.bind('machine-b', 'MacBook', 'project-1');
        expect(() => requirePeerLinks(peer('machine-a'), links)).toThrow(expect.objectContaining({ code: 'peer-not-linked' }));
    });

    test('a client that is no peer has no links', () => {
        const client: ClientConnection = { id: 'c1', access: { reachability: 'lan', sessionId: 's1' }, send: () => undefined };
        expect(() => requirePeerLinks(client, links)).toThrow(expect.objectContaining({ code: 'peer-not-linked' }));
    });

    test('a linked peer gets its own links and no other machine`s', async () => {
        await links.bind('machine-a', 'Studio', 'project-1', 'auto-accept-edits');
        await links.bind('machine-b', 'MacBook', 'project-2');
        expect(requirePeerLinks(peer('machine-a'), links)).toMatchObject([{ machineId: 'machine-a', projectId: 'project-1', ceiling: 'auto-accept-edits' }]);
    });

    test('unlinking takes the access away again', async () => {
        await links.bind('machine-a', 'Studio', 'project-1');
        await links.unbind('machine-a', 'project-1');
        expect(() => requirePeerLinks(peer('machine-a'), links)).toThrow(expect.objectContaining({ code: 'peer-not-linked' }));
    });
});
