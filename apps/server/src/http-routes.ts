import type { Server } from 'bun';

export interface RouteRequest<Data> {
    request: Request;
    url: URL;
    /* The address the request came from; empty when the server cannot tell. */
    remote: string;
    server: Server<Data>;
}

/* Undefined once the request became a socket, which has no response of its own. */
export type RouteHandler<Data> = (route: RouteRequest<Data>) => Promise<Response | undefined> | Response | undefined;

export interface Route<Data> {
    /* The paths answered as they are. */
    exact?: readonly string[];
    /* A prefix whose every path below it is answered; the prefix itself only when `exact` names it too. */
    below?: string;
    handle: RouteHandler<Data>;
}

/* The first route that answers a path, in the order of the table. */
export function routeFor<Data>(routes: readonly Route<Data>[], pathname: string): Route<Data> | null {
    return routes.find((route) => route.exact?.includes(pathname) === true || (route.below !== undefined && pathname.startsWith(`${route.below}/`))) ?? null;
}

/* Answers a request from the table, and 404 for a path no route answers. */
export async function answerRoute<Data>(routes: readonly Route<Data>[], request: Request, server: Server<Data>): Promise<Response | undefined> {
    const url = new URL(request.url);
    const route = routeFor(routes, url.pathname);
    if (route === null) {
        return new Response('Not found', { status: 404 });
    }
    return route.handle({ request, url, remote: server.requestIP(request)?.address ?? '', server });
}
