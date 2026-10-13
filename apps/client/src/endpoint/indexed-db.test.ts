import { describe, expect, test } from 'bun:test';
import { objectStoreRunner } from './indexed-db';

type Step = () => void;

/*
 * Just enough of IndexedDB for one object store: a request succeeds a step before its transaction
 * commits, and a failed request aborts the transaction, the way a browser orders the two.
 */
function fakeIndexedDb() {
    const records = new Map<IDBValidKey, unknown>();
    const steps: Step[] = [];
    let opened = 0;
    let closed = 0;

    const later = (step: Step): void => void steps.push(step);
    const step = async (): Promise<void> => {
        steps.shift()?.();
        await new Promise((resolve) => setImmediate(resolve));
    };
    const run = async (): Promise<void> => {
        await new Promise((resolve) => setImmediate(resolve));
        while (steps.length > 0) {
            await step();
        }
    };

    const transaction = (): IDBTransaction => {
        const tx = { error: null as DOMException | null } as IDBTransaction & { error: DOMException | null };
        const request = <T>(outcome: () => T): IDBRequest<T> => {
            const req = {} as IDBRequest<T> & { result: T; error: DOMException | null };
            later(() => {
                try {
                    req.result = outcome();
                    req.onsuccess?.(new Event('success'));
                    later(() => tx.oncomplete?.(new Event('complete')));
                } catch (e) {
                    req.error = e as DOMException;
                    tx.error = e as DOMException;
                    later(() => tx.onabort?.(new Event('abort')));
                }
            });
            return req;
        };
        const store = {
            get: (key: IDBValidKey) => request(() => records.get(key)),
            put: (value: unknown, key: IDBValidKey) =>
                request(() => {
                    records.set(key, value);
                    return key;
                }),
            add: (value: unknown, key: IDBValidKey) =>
                request(() => {
                    if (records.has(key)) {
                        throw new DOMException('Key already exists', 'ConstraintError');
                    }
                    records.set(key, value);
                    return key;
                })
        };
        Object.assign(tx, { objectStore: () => store });
        return tx;
    };

    const factory = {
        open: () => {
            opened += 1;
            const db = { transaction, close: () => void (closed += 1), createObjectStore: () => undefined } as unknown as IDBDatabase;
            const req = { result: db } as IDBOpenDBRequest;
            later(() => req.onsuccess?.(new Event('success')));
            return req;
        }
    } as unknown as IDBFactory;

    return {
        factory,
        step,
        run,
        get opened() {
            return opened;
        },
        get closed() {
            return closed;
        }
    };
}

describe('objectStoreRunner', () => {
    test('a write answers only once its transaction committed, and closes its connection', async () => {
        const fake = fakeIndexedDb();
        const run = objectStoreRunner('db', 'store', fake.factory);
        let answered = false;
        const written = run('readwrite', (store) => store.put('value', 'key')).then(() => {
            answered = true;
        });

        await fake.step();
        await fake.step();
        expect(answered).toBe(false);
        await fake.step();
        await written;
        expect(answered).toBe(true);

        const read = run('readonly', (store) => store.get('key'));
        await fake.run();
        expect(await read).toBe('value');
        expect(fake.closed).toBe(fake.opened);
    });

    test('a request that fails aborts the transaction, and the caller gets its error', async () => {
        const fake = fakeIndexedDb();
        const run = objectStoreRunner('db', 'store', fake.factory);
        await Promise.all([run('readwrite', (store) => store.add('first', 'key')), fake.run()]);

        const refused = run('readwrite', (store) => store.add('second', 'key')).catch((e: unknown) => e);
        await fake.run();
        expect(await refused).toMatchObject({ name: 'ConstraintError' });
        expect(fake.closed).toBe(fake.opened);
    });

    test('a request that throws before it is sent still closes the connection', async () => {
        const fake = fakeIndexedDb();
        const run = objectStoreRunner('db', 'store', fake.factory);
        const refused = run('readwrite', () => {
            throw new DOMException('Could not be cloned', 'DataCloneError');
        }).catch((e: unknown) => e);
        await fake.run();
        expect(await refused).toMatchObject({ name: 'DataCloneError' });
        expect(fake.closed).toBe(1);
    });
});
