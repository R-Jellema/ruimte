import { chatSink, useChats, type ChatSink } from '@adecore/agents-react/state';
import { ChatInfoSchema, type ChatEvent, type ChatItem } from '@ruimte/contracts';
import { chatInfoOf } from '../chat-info';
import { median } from './bench';

const count = Number(process.env.BENCH_ITEMS ?? 6000);
const updates = Number(process.env.BENCH_UPDATES ?? 200);
const runs = Number(process.env.BENCH_RUNS ?? 7);
const live = process.env.BENCH_LIVE === '1';
if (![count, updates, runs].every((value) => Number.isInteger(value) && value > 0)) {
    throw new Error('BENCH_ITEMS, BENCH_UPDATES and BENCH_RUNS must be positive integers');
}
const info = ChatInfoSchema.parse(
    chatInfoOf('replay', {
        cwd: '/',
        selection: { model: 'claude-sonnet-5', options: {} },
        status: 'running',
        running: true,
        activeTurnId: 'turn',
        usage: { contextTokens: 0, contextWindow: null, costUsd: 0, turns: 0 }
    })
);
const items: ChatItem[] = Array.from({ length: count }, (_, index) => ({
    id: 'item-' + index,
    kind: 'user',
    createdAt: index,
    turnId: null,
    text: 'Earlier message ' + index
}));
items.push({ id: 'reply', kind: 'assistant', turnId: 'turn', createdAt: count, text: 'Hello', streaming: true });
const events: ChatEvent[] = Array.from({ length: updates }, () => ({ type: 'delta', itemId: 'reply', text: ' world' }));
const key = 'replay-benchmark/chat';
const sink: ChatSink & { replay?: (chatId: string, events: ChatEvent[]) => void } = chatSink(() => key);
const samples = [];
for (let run = -1; run < runs; run++) {
    sink.reset('chat', info, items);
    const previous = useChats.getState().byKey[key]!;
    let notifications = 0;
    const stop = useChats.subscribe(() => notifications++);
    const started = performance.now();
    if (sink.replay && !live) {
        sink.replay('chat', events);
    } else {
        for (const event of events) {
            sink.apply('chat', event);
        }
    }
    const ms = performance.now() - started;
    stop();
    const next = useChats.getState().byKey[key]!;
    const expected = 'Hello' + ' world'.repeat(updates);
    if (
        next.items.reply?.kind !== 'assistant' ||
        next.items.reply.text !== expected ||
        previous.items.reply?.kind !== 'assistant' ||
        previous.items.reply.text !== 'Hello' ||
        next.order !== previous.order ||
        next.structure !== previous.structure
    ) {
        throw new Error('Replay changed history, structure or the previous snapshot');
    }
    if (run >= 0) {
        samples.push({ ms, notifications });
    }
}
useChats.getState().forget(key);
console.log(JSON.stringify({ benchmark: 'chat-client-replay', count, updates, runs, batch: Boolean(sink.replay) && !live, samples }, null, 2));
if (median(samples.map((sample) => sample.ms)) > Number(process.env.BENCH_MAX_REPLAY_MS ?? Infinity)) {
    throw new Error('Chat replay exceeded its timing budget');
}
