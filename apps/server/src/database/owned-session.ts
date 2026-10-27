import type { DatabaseError, DatabaseResponse, ServerInfo } from '@adecore/database/protocol';

export type SessionCall = <R>(method: string, params: Record<string, unknown>) => Promise<R>;

export interface DatabaseCalls {
    handle(request: unknown, owner: string): Promise<DatabaseResponse>;
    release(owner: string): Promise<void>;
}

interface OwnedSessionOptions {
    service: DatabaseCalls;
    owner: string;
    connection: Record<string, unknown>;
    limitMs: number;
    /* Turns a failed call into what the caller throws; `timedOut` once the limit released the session under it. */
    fail(method: string, error: DatabaseError, timedOut: boolean): never;
    /* Releases the session at once when its signal aborts, and fails every call after that with `stopped`. */
    abort?: { signal: AbortSignal; stopped(): never };
}

/*
 * Opens a session under an owner of its own, runs `work` on it and releases the owner before it answers,
 * so no session, transaction or temporary table outlives the call. Past `limitMs` the owner is released,
 * which fails the call under way.
 */
export async function inOwnedSession<T>(options: OwnedSessionOptions, work: (call: SessionCall, server: ServerInfo) => Promise<T>): Promise<T> {
    const { service, owner } = options;
    const signal = options.abort?.signal;
    let requests = 0;
    let timedOut = false;
    const release = (): void => {
        void service.release(owner);
    };
    const timer = setTimeout(() => {
        timedOut = true;
        release();
    }, options.limitMs);
    signal?.addEventListener('abort', release, { once: true });
    const call: SessionCall = async <R>(method: string, params: Record<string, unknown>): Promise<R> => {
        if (options.abort?.signal.aborted) {
            options.abort.stopped();
        }
        const answer = await service.handle({ id: `r${++requests}`, method, params }, owner);
        if (answer.ok) {
            return answer.result as R;
        }
        return options.fail(method, answer.error, timedOut);
    };
    try {
        const opened = await call<{ session: string; server: ServerInfo }>('open', { connection: options.connection });
        return await work((method, params) => call(method, { session: opened.session, ...params }), opened.server);
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', release);
        await service.release(owner);
    }
}
