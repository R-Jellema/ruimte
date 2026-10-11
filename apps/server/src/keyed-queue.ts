/* Work that runs one at a time per key, in the order it came, and leaves nothing behind once a key has settled. */
export class KeyedQueue {
    private readonly tails = new Map<string, Promise<unknown>>();

    get size(): number {
        return this.tails.size;
    }

    run<T>(key: string, work: () => Promise<T>): Promise<T> {
        const next = (this.tails.get(key) ?? Promise.resolve()).then(work, work);
        const tail = next.then(
            () => undefined,
            () => undefined
        );
        this.tails.set(key, tail);
        void tail.then(() => {
            if (this.tails.get(key) === tail) {
                this.tails.delete(key);
            }
        });
        return next;
    }
}
