import { ClientSinks as Sinks } from '@adecore/agents/host';
import type { LiveFrame } from '@ruimte/contracts';
import type { SessionEvent, SessionSink } from './sessions/manager.ts';

/* The clients listening to one part of the daemon, the `Subscribable` in `connection.ts` made real. */
export class ClientSinks extends Sinks<SessionEvent> {}

/* The clients of a part that hear its events only after they asked for them with `<area>.watch`. */
export class WatchedSinks {
    private readonly sinks = new ClientSinks();
    private readonly watching = new Set<string>();

    subscribe(clientId: string, sink: SessionSink): () => void {
        const unsubscribe = this.sinks.subscribe(clientId, sink);
        return () => {
            this.watching.delete(clientId);
            unsubscribe();
        };
    }

    watch(clientId: string): void {
        this.watching.add(clientId);
    }

    unwatch(clientId: string): void {
        this.watching.delete(clientId);
    }

    emit(event: SessionEvent): void {
        for (const clientId of this.watching) {
            this.sinks.to(clientId, event);
        }
    }
}

/* What a part with live streams sends: an event, or a frame for a client that asked for its pictures in binary. */
export type LiveEvent = SessionEvent | LiveFrame;
export type LiveSink = (event: LiveEvent) => void;

export class LiveSinks extends Sinks<LiveEvent> {}

export function isLiveFrame(event: LiveEvent): event is LiveFrame {
    return 'bytes' in event;
}
