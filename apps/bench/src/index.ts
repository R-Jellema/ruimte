import { staticAssetsWorker } from '@ruimte/csp';
import { withSecurityHeaders } from './headers.ts';

interface Env {
    ASSETS: Fetcher;
}

/* The model comparison at `bench.ruimte.app`: the client's `bench` build as static assets, the page for every path that is no file. */
export default staticAssetsWorker(withSecurityHeaders) satisfies ExportedHandler<Env>;
