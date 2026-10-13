import i18next from 'i18next';

export type ObjectStoreRunner = <T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest<T>) => Promise<T>;

/*
 * Runs one request against a single object store, opening (and on first use creating) its database
 * each time. The answer waits for the transaction to commit, and the connection is closed after it.
 */
export function objectStoreRunner(dbName: string, storeName: string, factory?: IDBFactory): ObjectStoreRunner {
    const open = (): Promise<IDBDatabase> =>
        new Promise((resolve, reject) => {
            const request = (factory ?? indexedDB).open(dbName, 1);
            request.onupgradeneeded = () => request.result.createObjectStore(storeName);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error ?? new Error(i18next.t('machines:storage.indexedDbClosed')));
        });

    return <T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
        open().then(
            (db) =>
                new Promise<T>((resolve, reject) => {
                    const refused = (error: unknown): void => {
                        db.close();
                        reject(error ?? new Error(i18next.t('machines:storage.indexedDbRefused')));
                    };
                    let transaction: IDBTransaction;
                    let request: IDBRequest<T>;
                    try {
                        transaction = db.transaction(storeName, mode);
                        request = act(transaction.objectStore(storeName));
                    } catch (e) {
                        refused(e);
                        return;
                    }
                    transaction.oncomplete = () => {
                        db.close();
                        resolve(request.result);
                    };
                    // A failed request aborts its transaction, so the abort is where every failure ends up.
                    transaction.onabort = () => refused(transaction.error ?? request.error);
                })
        );
}
