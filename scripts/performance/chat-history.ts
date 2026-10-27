import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { ChatInfo, ChatItem } from '../../packages/contracts/src/index';
import { assertMedianWithin } from './budget';

const shared = realpathSync(join(import.meta.dir, '../../apps/server/node_modules/@adecore/agents/src'));
const { ChatThread } = await import(join(shared, 'chat/thread.ts'));
const count = Number(process.env.BENCH_ITEMS ?? 30_000);
const runs = Number(process.env.BENCH_RUNS ?? 11);
const items: ChatItem[] = Array.from({ length: count }, (_, index) => ({
    id: `item-${index}`,
    kind: 'assistant',
    turnId: null,
    createdAt: index,
    streaming: false,
    text: `Message ${index}: ${'An older paragraph of the conversation. '.repeat(30)}`
}));
items[0] = {
    id: 'pending',
    kind: 'approval',
    createdAt: 0,
    turnId: null,
    requestId: 'request',
    toolUseId: null,
    toolName: 'Bash',
    input: {},
    description: null,
    canAllowAlways: false,
    decision: 'pending'
};
items[1] = { id: 'last-user', kind: 'user', createdAt: 1, turnId: null, text: 'Continue' };
items[2] = {
    id: 'running-agent',
    kind: 'subagent',
    createdAt: 2,
    turnId: null,
    toolUseId: 'agent',
    status: 'running',
    finishedAt: null
} as ChatItem;
const thread = new ChatThread({ chatId: 'benchmark' } as ChatInfo, items);
const samples = [];
for (let run = 0; run < runs; run++) {
    const started = performance.now();
    const page = thread.history(90);
    const pending = thread.pending();
    const subagents = thread.subagentsBefore(page.history.start);
    samples.push(performance.now() - started);
    if (page.items.length !== 90 || pending[0]?.id !== 'pending' || subagents[0]?.id !== 'running-agent') {
        throw new Error('History snapshot lost content outside the page');
    }
}
const pages = [];
let cursor: string | undefined;
for (let run = 0; run < runs; run++) {
    const started = performance.now();
    const page = thread.history(90, cursor);
    pages.push(performance.now() - started);
    cursor = page.history.cursor ?? undefined;
    if (page.items.length !== 90) {
        throw new Error('History page lost messages');
    }
}
console.log(JSON.stringify({ benchmark: 'chat-history-snapshot', count, runs, samples, pages }, null, 2));
assertMedianWithin(samples.slice(1), 'BENCH_MAX_WARM_MS', 'Warm chat snapshot exceeded its timing budget');
