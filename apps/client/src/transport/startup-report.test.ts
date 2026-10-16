import { describe, expect, test } from 'bun:test';
import type { EventMap, EventType, RequestMap, RequestType } from '@ruimte/contracts';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import type { WatchablePool } from './pool-watch';
import { startStartupReport } from './startup-report';
import type { ConnectionState, Transport, TransportStatus } from './transport';

class FakeLink implements Transport {
    status: TransportStatus = 'open';
    connection: ConnectionState;
    readonly asked: Array<{ type: string; payload: unknown }> = [];

    constructor(features: string[]) {
        this.connection = { status: 'open', attempts: 0, retryAt: null, failure: null, features };
    }

    request<T extends RequestType>(type: T, payload: RequestMap[T]['payload']): Promise<RequestMap[T]['result']> {
        this.asked.push({ type, payload });
        return Promise.resolve({} as RequestMap[T]['result']);
    }

    on<E extends EventType>(_event: E, _handler: (payload: EventMap[E]) => void): () => void {
        return () => undefined;
    }

    subscribeStatus(): () => void {
        return () => undefined;
    }
}

function poolOf(links: Record<string, FakeLink>): WatchablePool {
    return { ids: () => Object.keys(links), peek: (endpointId) => links[endpointId] ?? null, subscribe: () => () => undefined };
}

async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('the startup report', () => {
    test('sends the time the shell hands out to this machine only, once', async () => {
        const local = new FakeLink(['usage.startup']);
        const other = new FakeLink(['usage.startup']);
        let taken = 0;
        startStartupReport(
            async () => {
                taken += 1;
                return 1834.4;
            },
            poolOf({ [LOCAL_ENDPOINT_ID]: local, elsewhere: other })
        );
        await settle();
        expect(taken).toBe(1);
        expect(local.asked).toEqual([{ type: 'usage.startup', payload: { ms: 1834 } }]);
        expect(other.asked).toEqual([]);
    });

    test('asks nothing of a machine that does not answer it, and sends nothing the shell withholds', async () => {
        const older = new FakeLink([]);
        let taken = 0;
        startStartupReport(
            async () => {
                taken += 1;
                return null;
            },
            poolOf({ [LOCAL_ENDPOINT_ID]: older })
        );
        const current = new FakeLink(['usage.startup']);
        startStartupReport(async () => null, poolOf({ [LOCAL_ENDPOINT_ID]: current }));
        await settle();
        expect(taken).toBe(0);
        expect(current.asked).toEqual([]);
    });
});
