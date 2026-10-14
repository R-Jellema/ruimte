import type { Env } from './env.ts';
import { handle } from './handler.ts';

export default {
    fetch(request, env, context) {
        return handle(request, env, {
            fetch: (url, init) => fetch(url, init),
            cache: caches.default,
            now: () => Date.now(),
            defer: (work) => context.waitUntil(work)
        });
    }
} satisfies ExportedHandler<Env>;
