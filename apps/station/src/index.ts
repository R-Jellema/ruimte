import { staticAssetsWorker } from '@ruimte/csp';
import { withSecurityHeaders } from './headers.ts';

interface Env {
    ASSETS: Fetcher;
}

/* The web client: the built `apps/client` as static assets, with a page for every path that is not a file (a login comes back on `/pulsar/callback`). */
export default staticAssetsWorker(withSecurityHeaders) satisfies ExportedHandler<Env>;
