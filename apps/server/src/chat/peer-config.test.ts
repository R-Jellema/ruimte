import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatTurnItem } from '@ruimte/contracts';
import { ManualClock } from '@adecore/agents/testing';
import { projectLinks } from '../projects/project-file-test-helpers.ts';
import { ProjectStore } from '../projects/project-store.ts';
import { bootTestDaemon, type TestDaemon } from '../tasks/test-daemon.ts';

let root: string;
let folder: string;
let store: ProjectStore;
let daemon: TestDaemon;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-peer-config-'));
    folder = join(root, 'repo');
    await mkdir(folder, { recursive: true });
    store = new ProjectStore(join(root, 'home'), projectLinks());
    await store.openProject({ folder });
    daemon = await bootTestDaemon({ home: join(root, 'home'), store, clock: new ManualClock(), installed: ['claude', 'codex'] });
    daemon.worker.start();
});

afterEach(async () => {
    await daemon.stop();
    store.closeAll();
    await rm(root, { recursive: true, force: true });
});

async function say(chatId: string): Promise<void> {
    const turns = (): ChatTurnItem[] => (daemon.chats.get(chatId)?.thread.list() ?? []).filter((item): item is ChatTurnItem => item.kind === 'turn');
    await daemon.chats.send(chatId, 'hello');
    await daemon.until(() => daemon.chats.get(chatId)?.info.activeTurnId === null && turns().length === 1);
}

describe('the configuration a chat CLI loads from its folder', () => {
    test('a chat of this machine loads it as always', async () => {
        await daemon.chats.create({ chatId: 'chat-own', provider: 'claude', cwd: folder });
        await say('chat-own');
        expect(daemon.chatCommands.at(-1)).not.toContain('--setting-sources=user');
        expect(daemon.chatCommands.at(-1)).not.toContain('--strict-mcp-config');
    });

    test('a chat that another machine gave its task never loads what the files it sent carry', async () => {
        await daemon.lineage.put({
            projectId: 'p',
            nodeId: 'chat-peer',
            openedBy: 'peer:machine-a:parent',
            depth: 1,
            agent: true,
            peer: { machineId: 'machine-a' }
        });
        await daemon.chats.create({ chatId: 'chat-peer', provider: 'claude', cwd: folder });
        await say('chat-peer');
        expect(daemon.chatCommands.at(-1)).toContain('--setting-sources=user');
        expect(daemon.chatCommands.at(-1)).toContain('--strict-mcp-config');
    });
});
