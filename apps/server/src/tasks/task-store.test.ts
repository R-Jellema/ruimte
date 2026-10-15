import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RuimteTaskStore } from './task-store.ts';

let home: string;
let tasks: RuimteTaskStore;

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-task-store-'));
    tasks = new RuimteTaskStore(home);
});

afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

const record = (childId: string) => ({ projectId: 'p', parentId: 'lead', childId, title: childId, prompt: 'Go' });

test('a task that settles while the wakes of its parent are dropped stays settled', async () => {
    const first = await tasks.open(record('a'), 1);
    const second = await tasks.open(record('b'), 2);

    const dropping = tasks.dropWake('lead');
    const settling = tasks.settle(second.id, 'failed', { text: 'gone', source: 'exit', at: 3 }, 3);
    await Promise.all([dropping, settling]);

    expect(tasks.get(second.id)).toMatchObject({ status: 'failed', result: { text: 'gone' } });
    expect(tasks.get(first.id)).toMatchObject({ status: 'open' });
    expect(tasks.pendingWake('lead')).toEqual([]);
});
