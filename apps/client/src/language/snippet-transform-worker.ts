export function createSnippetTransformWorker(): Worker {
    return new Worker(new URL('./snippet-transform.worker.ts', import.meta.url), { type: 'module' });
}
