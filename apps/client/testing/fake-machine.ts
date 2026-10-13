import { spyOn } from 'bun:test';
import { REQUEST_SCHEMAS, type EventMap, type EventType, type RequestMap, type RequestType } from '@ruimte/contracts';
import { LOCAL_ENDPOINT_ID, endpointById } from '@/state/endpoints';
import { pool } from '@/transport';
import type { PooledTransport } from '@/transport/pool';
import type { ConnectionState } from '@/transport/transport';

const OPEN: ConnectionState = { status: 'open', attempts: 0, retryAt: null };

interface SchemaDef {
    type: string;
    shape?: Record<string, { _zod: { def: SchemaDef; optin?: string } }>;
    innerType?: { _zod: { def: SchemaDef } };
    options?: Array<{ _zod: { def: SchemaDef } }>;
    in?: { _zod: { def: SchemaDef } };
    values?: unknown[];
    entries?: Record<string, unknown>;
}

/*
 * The emptiest answer the wire allows: no rows in a list, nothing in a map, a field left out where it
 * may be. What a machine with nothing on it says, read off the schema the client parses it with.
 */
function emptyOf(def: SchemaDef): unknown {
    switch (def.type) {
        case 'object':
            return Object.fromEntries(
                Object.entries(def.shape ?? {})
                    .filter(([, field]) => field._zod.optin !== 'optional')
                    .map(([name, field]) => [name, emptyOf(field._zod.def)])
            );
        case 'array':
            return [];
        case 'record':
            return {};
        case 'string':
            return '';
        case 'number':
        case 'int':
            return 0;
        case 'boolean':
            return false;
        case 'null':
        case 'nullable':
            return null;
        case 'literal':
            return def.values?.[0];
        case 'enum':
            return Object.values(def.entries ?? {})[0];
        case 'union':
            return emptyOf(def.options![0]!._zod.def);
        case 'pipe':
            return emptyOf(def.in!._zod.def);
        case 'default':
        case 'readonly':
        case 'catch':
        case 'nonoptional':
            return emptyOf(def.innerType!._zod.def);
        default:
            return undefined;
    }
}

type Answer<T extends RequestType> = (payload: RequestMap[T]['payload']) => RequestMap[T]['result'] | Promise<RequestMap[T]['result']>;

export interface SentRequest {
    type: RequestType;
    payload: unknown;
}

/* A machine that answers what a test tells it to and the emptiest answer to everything else, and keeps every request it got. */
export class FakeMachine implements PooledTransport {
    readonly status = 'open' as const;
    readonly connection = OPEN;
    readonly sent: SentRequest[] = [];
    private readonly answers = new Map<RequestType, Answer<RequestType>>();
    private readonly handlers = new Map<EventType, Set<(payload: never) => void>>();

    answer<T extends RequestType>(type: T, answer: Answer<T>): void {
        this.answers.set(type, answer as unknown as Answer<RequestType>);
    }

    /* The requests of one type, in the order they came. */
    requests<T extends RequestType>(type: T): Array<RequestMap[T]['payload']> {
        return this.sent.filter((request) => request.type === type).map((request) => request.payload as RequestMap[T]['payload']);
    }

    emit<E extends EventType>(event: E, payload: EventMap[E]): void {
        for (const handler of this.handlers.get(event) ?? []) {
            (handler as (payload: EventMap[E]) => void)(payload);
        }
    }

    async request<T extends RequestType>(type: T, payload: RequestMap[T]['payload']): Promise<RequestMap[T]['result']> {
        this.sent.push({ type, payload });
        const answer = this.answers.get(type);
        if (answer !== undefined) {
            return (await answer(payload)) as RequestMap[T]['result'];
        }
        const schema = (REQUEST_SCHEMAS as unknown as Record<string, { result: { _zod: { def: SchemaDef } } }>)[type];
        return emptyOf(schema!.result._zod.def) as RequestMap[T]['result'];
    }

    on<E extends EventType>(event: E, handler: (payload: EventMap[E]) => void): () => void {
        let handlers = this.handlers.get(event);
        if (handlers === undefined) {
            handlers = new Set();
            this.handlers.set(event, handlers);
        }
        handlers.add(handler as (payload: never) => void);
        return () => {
            handlers.delete(handler as (payload: never) => void);
        };
    }

    subscribeStatus(): () => void {
        return () => undefined;
    }

    switchTo(): void {}

    retarget(): void {}

    reconnect(): void {}

    dispose(): void {}
}

/*
 * Puts a fake behind this machine's row in the pool, the one door a socket opens through, so every
 * client of the page reaches it the way it reaches a daemon. The returned function lets it go again.
 */
export function connectFakeMachine(machine: FakeMachine, endpointId: string = LOCAL_ENDPOINT_ID): () => void {
    const endpoint = endpointById(endpointId);
    if (endpoint === null) {
        throw new Error(`No row for ${endpointId}`);
    }
    const open = spyOn(pool as unknown as { open: () => PooledTransport }, 'open').mockImplementation(() => machine);
    const release = pool.hold(endpoint);
    return () => {
        release();
        pool.drop(endpointId);
        open.mockRestore();
    };
}
