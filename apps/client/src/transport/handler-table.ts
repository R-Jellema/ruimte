/*
 * Handlers by node id, which is how every client hands a stream from one machine to the components
 * drawing it: many nodes on a socket, and a node with more than one listener on it.
 */
export class HandlerTable<T> {
    private readonly byId = new Map<string, Set<(value: T) => void>>();

    listen(id: string, handler: (value: T) => void): () => void {
        const handlers = this.byId.get(id) ?? new Set<(value: T) => void>();
        this.byId.set(id, handlers);
        handlers.add(handler);
        return () => {
            handlers.delete(handler);
            if (handlers.size === 0) {
                this.byId.delete(id);
            }
        };
    }

    fanOut(id: string, value: T): void {
        const handlers = this.byId.get(id);
        if (handlers === undefined) {
            return;
        }
        // A copy, so a handler that unsubscribes while it runs does not change the set being walked.
        for (const handler of [...handlers]) {
            handler(value);
        }
    }

    clear(): void {
        this.byId.clear();
    }
}
