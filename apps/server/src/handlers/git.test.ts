import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerFrame } from '@ruimte/contracts';
import { FakeWatch } from '@adecore/agents/testing';
import { Dispatcher } from '../dispatcher.ts';
import { GitStatusWatcher } from '../git/status-watcher.ts';
import { initRepo } from '../git/test-repo.ts';
import { registerGitHandlers } from './git.ts';

let root: string;

beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-git-handlers-')));
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

test('a client that closed while its git.watch was set up leaves no watcher behind', async () => {
    const repo = join(root, 'repo');
    await initRepo(repo, { 'a.txt': 'a\n' });
    const fake = new FakeWatch();
    const statuses = new GitStatusWatcher('darwin', fake);
    const dispatcher = new Dispatcher();
    registerGitHandlers(dispatcher, {} as never, {} as never, statuses, {} as never);
    const client = { id: 'phone', closed: false, send: (_frame: ServerFrame) => undefined };

    const handled = dispatcher.handle(client, JSON.stringify({ id: 'watch', type: 'git.watch', payload: { cwd: repo } }));
    // The socket goes before git answered, and its cleanup ran with nothing to clean yet.
    client.closed = true;
    statuses.detachAll('phone');
    await handled;

    expect(fake.openOn(repo)).toHaveLength(0);
});

test('git.pr-watch refuses a chat the project does not place', async () => {
    const started: string[] = [];
    const watches = { start: (projectId: string, chatId: string) => (started.push(`${projectId}/${chatId}`), Promise.resolve({ chatId })) };
    const dispatcher = new Dispatcher();
    const placeOf = (id: string) => (id === 'chat-in' ? { projectId: 'p' } : null);
    registerGitHandlers(dispatcher, {} as never, {} as never, {} as never, {} as never, watches as never, placeOf);
    const replies: ServerFrame[] = [];
    const client = { id: 'phone', closed: false, send: (frame: ServerFrame) => replies.push(frame) };
    const ask = (id: string, chatId: string, projectId: string) =>
        dispatcher.handle(client, JSON.stringify({ id, type: 'git.pr-watch', payload: { projectId, chatId, cwd: '/repo' } }));

    await ask('a', 'chat-in', 'p');
    await ask('b', 'chat-in', 'other');
    await ask('c', 'chat-out', 'p');

    expect(started).toEqual(['p/chat-in']);
    expect(replies.map((frame) => ('ok' in frame ? frame.ok : null))).toEqual([true, false, false]);
    expect(replies[1]).toMatchObject({ error: { code: 'pr-watch-refused' } });
});
