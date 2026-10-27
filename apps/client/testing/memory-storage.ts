/* A `Storage` that keeps its entries in `values`, for a test that reads what a module wrote. */
export function memoryStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & { values: Map<string, string> } {
    const values = new Map<string, string>();

    return {
        values,
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => void values.set(key, value),
        removeItem: (key) => void values.delete(key)
    };
}
