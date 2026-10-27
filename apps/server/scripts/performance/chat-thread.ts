import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatThread, ChatStore } from '@adecore/agents/chat';
import { ChatInfoSchema, ChatItemSchema, type ChatApprovalItem, type ChatEvent, type ChatItem } from '@ruimte/contracts';
import { assertMedianWithin } from '../../../../scripts/performance/budget';

const count = Number(process.env.BENCH_ITEMS ?? 30_000);
const updates = Number(process.env.BENCH_UPDATES ?? 200);
const runs = Number(process.env.BENCH_RUNS ?? 9);
if (!Number.isInteger(count) || count < 1 || !Number.isInteger(updates) || updates < 2 || updates % 2 !== 0 || !Number.isInteger(runs) || runs < 1) {
    throw new Error('BENCH_ITEMS and BENCH_RUNS must be positive integers; BENCH_UPDATES must be positive and even');
}
const info = ChatInfoSchema.parse({
    chatId: 'thread-performance',
    provider: 'claude',
    cwd: '/',
    agentSessionId: null,
    model: null,
    selection: { model: 'claude-sonnet-5', options: {} },
    runtimeMode: 'supervised',
    status: 'running',
    running: true,
    activeTurnId: 'turn',
    slashCommands: [],
    usage: { contextTokens: 0, contextWindow: null, costUsd: 0, turns: 0 },
    createdAt: 0
});
function approval(id: string, decision: 'pending' | 'allow'): ChatApprovalItem {
    return {
        id,
        kind: 'approval',
        createdAt: 1,
        turnId: 'turn',
        requestId: id,
        toolUseId: null,
        toolName: 'Bash',
        input: { command: 'ls' },
        description: null,
        canAllowAlways: false,
        decision
    };
}
const items: ChatItem[] = Array.from({ length: count }, (_, index) =>
    index % 10 === 0
        ? approval('item-' + index, 'allow')
        : { id: 'item-' + index, kind: 'user', createdAt: index, turnId: null, text: 'Earlier message ' + index }
);
items.forEach((item) => ChatItemSchema.parse(item));
const events: ChatEvent[] = Array.from({ length: updates }, (_, index) => ({ type: 'item', item: approval('live', index % 2 === 0 ? 'pending' : 'allow') }));
const temporary = await mkdtemp(join(tmpdir(), 'ruimte-chat-thread-bench-'));
try {
    const store = new ChatStore(temporary);
    await store.write(info.chatId, info, items);
    const log = events.map((event, index) => JSON.stringify({ seq: index + 1, at: index, event })).join('\n') + '\n';
    await writeFile(store.logPath(info.chatId), log);
    const samples = [];
    for (let run = -1; run < runs; run++) {
        const thread = new ChatThread(info, items);
        let expected = 0;
        const started = performance.now();
        for (const event of events) {
            thread.apply(event);
            const waiting = event.type === 'item' && event.item.kind === 'approval' && event.item.decision === 'pending';
            if (thread.statusFor('turn') !== (waiting ? 'needs-you' : 'running') || thread.pending().length !== Number(waiting)) {
                throw new Error('Pending requests or status diverged');
            }
            expected += Number(waiting);
        }
        const updatesMs = performance.now() - started;
        const reading = performance.now();
        const loaded = await store.read(info.chatId);
        const restoreMs = performance.now() - reading;
        if (loaded?.items.length !== count + 1 || loaded.info.requests !== undefined || expected !== Math.ceil(updates / 2)) {
            throw new Error('Chat restore lost history or retained completed requests');
        }
        if (run >= 0) {
            samples.push({ updatesMs, restoreMs });
        }
    }
    console.log(JSON.stringify({ benchmark: 'chat-thread-requests', count, updates, runs, samples }, null, 2));
    assertMedianWithin(
        samples.map((sample) => sample.updatesMs),
        'BENCH_MAX_UPDATES_MS',
        'Chat request processing exceeded its timing budget'
    );
} finally {
    await rm(temporary, { recursive: true, force: true });
}
