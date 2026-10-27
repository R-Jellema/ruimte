/* The items in the order of `compare`, taken off a heap one at a time, so a caller that stops early never sorts the rest. Empties `items`. */
export function* inOrder<T>(items: T[], compare: (left: T, right: T) => number): Generator<T> {
    const sink = (from: number): void => {
        const entry = items[from]!;
        let index = from;
        while (index * 2 + 1 < items.length) {
            let child = index * 2 + 1;
            if (child + 1 < items.length && compare(items[child + 1]!, items[child]!) < 0) {
                child++;
            }
            if (compare(entry, items[child]!) <= 0) {
                break;
            }
            items[index] = items[child]!;
            index = child;
        }
        items[index] = entry;
    };

    for (let index = Math.floor(items.length / 2) - 1; index >= 0; index--) {
        sink(index);
    }
    while (items.length > 0) {
        const best = items[0]!;
        const last = items.pop()!;
        if (items.length > 0) {
            items[0] = last;
            sink(0);
        }
        yield best;
    }
}

/* The first `limit` items in the order of `compare`. Empties `items` as far as it read. */
export function firstInOrder<T>(items: T[], compare: (left: T, right: T) => number, limit: number): T[] {
    const first: T[] = [];
    if (limit <= 0) {
        return first;
    }
    for (const item of inOrder(items, compare)) {
        first.push(item);
        if (first.length >= limit) {
            break;
        }
    }
    return first;
}
