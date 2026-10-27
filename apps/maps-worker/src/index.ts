import { captureException, withSentry } from '@sentry/cloudflare';
import type { Env } from './env.ts';
import { handle } from './handler.ts';
import { telemetryOptions } from './telemetry.ts';

const handler = {
    fetch(request, env, context) {
        return handle(request, env, {
            fetch: (url, init) => fetch(url, init),
            cache: caches.default,
            now: () => Date.now(),
            defer: (work) => context.waitUntil(work),
            report: (error) => captureException(error)
        });
    }
} satisfies ExportedHandler<Env>;

export default withSentry(telemetryOptions, handler);
