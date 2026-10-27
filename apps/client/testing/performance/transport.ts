import { EVENT_SCHEMAS, PROTOCOL_VERSION, PROJECT_VERSION, REQUEST_SCHEMAS, type EndpointInfo, type ChatHistoryResult } from '@ruimte/contracts';
import { Dispatcher } from '../../../server/src/dispatcher';
import { LinkTransport, type LinkEvents } from '../../src/transport/link-transport';
import { socketLink } from '../../src/transport/websocket-transport';
import { median } from './bench';

const runs = Number(process.env.BENCH_RUNS ?? 7);
const count = Number(process.env.BENCH_EVENTS ?? 1000);
const document = {
    version: PROJECT_VERSION,
    rev: 1,
    name: 'Transport benchmark',
    color: '#123456',
    shared: [],
    views: Array.from({ length: 500 }, (_, index) => ({ id: `view-${index}`, name: `Browser ${index}`, kind: 'browser' as const, url: 'https://example.com' }))
};
const project = { projectId: 'benchmark', document };
EVENT_SCHEMAS['project.changed'].parse(project);
const delta = { chatId: 'chat', event: { type: 'delta' as const, itemId: 'item', text: 'One more token.' } };
EVENT_SCHEMAS['chat.event'].parse(delta);
const history: ChatHistoryResult = {
    items: Array.from({ length: 90 }, (_, index) => ({
        id: `item-${index}`,
        kind: 'assistant',
        turnId: null,
        createdAt: index,
        streaming: false,
        text: 'A paragraph from an older message. '.repeat(40)
    })),
    history: { start: 0, cursor: null }
};
REQUEST_SCHEMAS['chat.history'].result.parse(history);

async function ready(transport: LinkTransport): Promise<void> {
    if (transport.status === 'open') {
        return;
    }
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Transport did not open')), 5000);
        const stop = transport.subscribeStatus((status) => {
            if (status === 'open') {
                clearTimeout(timer);
                stop();
                resolve();
            }
        });
    });
}
const endpoint: EndpointInfo = {
    id: 'benchmark',
    label: 'Benchmark',
    platform: 'benchmark',
    version: '0.0.0',
    reachability: 'loopback',
    authenticated: false,
    protocol: PROTOCOL_VERSION,
    features: Object.keys(REQUEST_SCHEMAS)
};
REQUEST_SCHEMAS['endpoint.info'].result.parse(endpoint);
const options = { log: { info: () => undefined, warn: () => undefined } };
let incoming: LinkEvents;
const local = new LinkTransport(
    'local',
    (_address, events) => {
        incoming = events;
        queueMicrotask(() => events.open());
        return {
            send: (raw) => {
                const frame = JSON.parse(raw) as { id: string };
                events.message(JSON.stringify({ id: frame.id, ok: true, result: endpoint }));
            },
            close: () => events.close(null)
        };
    },
    options
);
await ready(local);
const events = [];
try {
    for (const [event, payload, repetitions] of [
        ['chat.event', delta, count * 10],
        ['project.changed', project, count]
    ] as const) {
        const raw = JSON.stringify({ type: 'event', event, payload });
        for (const observed of [false, true]) {
            let delivered = 0;
            const stop = observed ? local.on(event, () => delivered++) : () => undefined;
            const samples = [];
            for (let run = 0; run < runs; run++) {
                const started = performance.now();
                for (let index = 0; index < repetitions; index++) {
                    incoming!.message(raw);
                }
                samples.push(performance.now() - started);
            }
            if (delivered !== (observed ? repetitions * runs : 0)) {
                throw new Error('Transport lost events');
            }
            stop();
            events.push({ event, observed, repetitions, bytes: new TextEncoder().encode(raw).length, samples });
        }
    }
} finally {
    local.dispose();
}

const dispatcher = new Dispatcher();
dispatcher.register('endpoint.info', () => endpoint);
dispatcher.register('server.ping', () => ({ time: 123 }));
dispatcher.register('chat.history', () => history);
const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request, server) => (server.upgrade(request) ? undefined : new Response('', { status: 426 })),
    websocket: {
        message: (socket, raw) =>
            void dispatcher.handle(
                {
                    id: 'transport-benchmark',
                    send: (frame) => {
                        socket.send(JSON.stringify(frame));
                    }
                },
                raw
            )
    }
});
const network = new LinkTransport(`ws://127.0.0.1:${server.port}`, socketLink, options);
const requests = [];
try {
    await ready(network);
    for (const type of ['server.ping', 'chat.history'] as const) {
        const samples = [];
        for (let run = 0; run < 300; run++) {
            const started = performance.now();
            if (type === 'server.ping') {
                if ((await network.request(type, {})).time !== 123) {
                    throw new Error('Ping changed');
                }
            } else if ((await network.request(type, { chatId: 'chat', cursor: 'page' })).items.length !== 90) {
                throw new Error('History lost messages');
            }
            samples.push(performance.now() - started);
        }
        requests.push({ type, samples });
    }
} finally {
    network.dispose();
    await server.stop(true);
}
console.log(JSON.stringify({ benchmark: 'client-daemon-transport', runs, events, requests }, null, 2));
const unused = events.find((row) => row.event === 'project.changed' && !row.observed)!;
if (median(unused.samples) > Number(process.env.BENCH_MAX_UNUSED_MS ?? Infinity)) {
    throw new Error('Unused event processing exceeded its timing budget');
}
