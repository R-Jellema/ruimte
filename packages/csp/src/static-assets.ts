/* What the Workers that serve a build of the client as static assets (the station, the bench) answer alike. */

export interface AssetsEnv {
    ASSETS: { fetch(request: Request): Promise<Response> };
}

/*
 * The answer with `headers` on it. Vite names what is under `/assets/` after its content, so those never
 * change and are cached for a year; everything else is asked for again, so a deploy reaches the next load.
 */
export function withHeaders(response: Response, pathname: string, headers: Readonly<Record<string, string>>, cached = true): Response {
    const answer = new Headers(response.headers);
    for (const [name, value] of Object.entries(headers)) {
        answer.set(name, value);
    }
    if (response.ok && cached) {
        answer.set('cache-control', pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: answer });
}

/*
 * A path under `/assets/` that is no file would get the page from `not_found_handling`, cached for a year
 * as if it were that chunk. A tab left open over a deploy asks for a chunk that is gone, and has to see it fail.
 */
export function notFoundForMissingAsset(response: Response, pathname: string): Response {
    if (!pathname.startsWith('/assets/') || !response.headers.get('content-type')?.startsWith('text/html')) {
        return response;
    }
    return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
}

/* The Worker runs first so no answer leaves without what `secure` puts on it, and plain `http:` goes to `https:`. */
export function staticAssetsWorker(secure: (response: Response, pathname: string) => Response) {
    return {
        async fetch(request: Request, env: AssetsEnv): Promise<Response> {
            const url = new URL(request.url);
            if (url.protocol === 'http:') {
                url.protocol = 'https:';
                return Response.redirect(url.toString(), 301);
            }
            return secure(notFoundForMissingAsset(await env.ASSETS.fetch(request), url.pathname), url.pathname);
        }
    };
}
