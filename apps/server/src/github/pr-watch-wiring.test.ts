import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatTurnItem, ProjectContent } from '@ruimte/contracts';
import { ManualClock } from '@adecore/agents/outbox/manual-clock';
import { ProjectStore } from '../projects/project-store.ts';
import { bootTestDaemon, type TestDaemon } from '../tasks/test-daemon.ts';

function content(): ProjectContent {
    return {
        name: 'repo',
        color: '#123456',
        views: [
            {
                kind: 'canvas',
                id: 'main',
                name: 'Canvas',
                nodes: [{ id: 'chat-watcher', kind: 'chat', title: 'Watcher', x: 0, y: 0, w: 560, h: 640, provider: 'claude' }],
                texts: [],
                edges: [],
                layouts: []
            }
        ]
    };
}

const page = JSON.stringify({
    data: {
        repository: {
            pullRequest: {
                number: 12,
                url: 'https://github.com/o/r/pull/12',
                state: 'OPEN',
                headRefOid: 'abc1234def',
                commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } } }] }
            }
        }
    }
});

let root: string;
let folder: string;
let store: ProjectStore;
let projectId: string;
let daemon: TestDaemon;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-pr-watch-wiring-'));
    folder = join(root, 'repo');
    await mkdir(folder, { recursive: true });
    store = new ProjectStore(join(root, 'home'));
    const opened = await store.openProject({ folder });
    projectId = opened.summary.projectId;
    await store.save(projectId, opened.document.rev, content());
    store.release(projectId);
    daemon = await bootTestDaemon({
        home: join(root, 'home'),
        store,
        clock: new ManualClock(),
        gh: (args) =>
            Promise.resolve(
                args[0] === 'pr'
                    ? { code: 0, stdout: JSON.stringify({ number: 12, url: 'https://github.com/o/r/pull/12' }), stderr: '' }
                    : { code: 0, stdout: page, stderr: '' }
            )
    });
    daemon.worker.start();
});

afterEach(async () => {
    await daemon.stop();
    store.closeAll();
    await rm(root, { recursive: true, force: true });
});

function turnsOf(): ChatTurnItem[] {
    return (daemon.chats.get('chat-watcher')?.thread.list() ?? []).filter((item): item is ChatTurnItem => item.kind === 'turn');
}

async function owe(): Promise<void> {
    const watch = await daemon.prWatches.start(projectId, 'chat-watcher', folder);
    await daemon.worker.enqueue(projectId, 'chat-watcher', {
        kind: 'deliver-pr-watch',
        payload: { watchId: watch.id, key: 'checks:abc1234def:failure', text: 'Checks on abc1234 finished: failed: lint.', label: 'PR #12: checks failed' }
    });
}

describe('a pull request watch waking a chat', () => {
    test('opens one agent turn with the label of the news', async () => {
        await daemon.chats.create({ chatId: 'chat-watcher', provider: 'claude', cwd: folder });
        await owe();
        await daemon.until(() => turnsOf().some((turn) => turn.label === 'PR #12: checks failed' && turn.state === 'done'));
        const woken = turnsOf().filter((turn) => turn.label === 'PR #12: checks failed');
        expect(woken).toHaveLength(1);
        expect(woken[0]!.origin).toBe('agent');
        expect(daemon.outbox.list()).toEqual([]);
    });

    test('a chat in a turn keeps the wake until the turn ends, and runs it once', async () => {
        await daemon.chats.create({ chatId: 'chat-watcher', provider: 'claude', cwd: folder });
        await daemon.chats.send('chat-watcher', 'plan the work');
        await owe();
        await daemon.until(() => turnsOf().some((turn) => turn.label === 'PR #12: checks failed' && turn.state === 'done'));
        expect(turnsOf().filter((turn) => turn.label === 'PR #12: checks failed')).toHaveLength(1);
        expect(daemon.outbox.list()).toEqual([]);
    });

    test('a watch that ended takes its wake along', async () => {
        await daemon.chats.create({ chatId: 'chat-watcher', provider: 'claude', cwd: folder });
        await daemon.worker.enqueue(projectId, 'chat-watcher', {
            kind: 'deliver-pr-watch',
            payload: { watchId: 'gone', key: 'k', text: 'Checks finished.', label: 'PR #12: checks failed' }
        });
        await daemon.until(() => daemon.outbox.list().length === 0);
        expect(turnsOf()).toEqual([]);
    });
});
