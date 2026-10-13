import { matchLines, type GrepWorkerMessage, type GrepWorkerRequest } from './grep-lines.ts';
import { readSearchable } from './searchable.ts';

/*
 * The search without ripgrep, on a thread of its own: a pattern that backtracks without end holds
 * this thread and never the daemon's, and `grep.ts` ends it by terminating the worker.
 */
declare const self: Worker;

function post(message: GrepWorkerMessage): void {
    self.postMessage(message);
}

async function search(request: GrepWorkerRequest): Promise<boolean> {
    const pattern = new RegExp(request.source, request.flags);
    let found = 0;
    for (const path of request.paths) {
        if (found >= request.limit) {
            return true;
        }
        const content = await readSearchable(request.root, path);
        if (content === null) {
            continue;
        }
        const matches = matchLines(path, content, pattern, request.limit - found);
        if (matches.length > 0) {
            found += matches.length;
            post({ kind: 'file', matches });
        }
    }
    return found >= request.limit;
}

self.onmessage = (event: MessageEvent<GrepWorkerRequest>) => {
    search(event.data).then(
        (truncated) => post({ kind: 'done', truncated }),
        (e: unknown) => post({ kind: 'failed', message: e instanceof Error ? e.message : String(e) })
    );
};
