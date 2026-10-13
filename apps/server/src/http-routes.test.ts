import { describe, expect, test } from 'bun:test';
import { routeFor, type Route } from './http-routes.ts';

const answer = (): Response => new Response('ok');

function table(): Route<unknown>[] {
    return [
        { exact: ['/health'], handle: answer },
        { exact: ['/machine/link', '/machine/registration'], handle: answer },
        { below: '/hooks', handle: answer },
        { exact: ['/context'], below: '/context', handle: answer }
    ];
}

describe('routeFor', () => {
    test('answers an exact path only as it is', () => {
        const routes = table();
        expect(routeFor(routes, '/health')).toBe(routes[0]!);
        expect(routeFor(routes, '/health/more')).toBeNull();
        expect(routeFor(routes, '/machine/registration')).toBe(routes[1]!);
    });

    test('answers every path below a prefix but not the prefix itself', () => {
        const routes = table();
        expect(routeFor(routes, '/hooks/claude')).toBe(routes[2]!);
        expect(routeFor(routes, '/hooks')).toBeNull();
        expect(routeFor(routes, '/hookshot')).toBeNull();
    });

    test('answers a prefix itself when the route names it as exact too', () => {
        const routes = table();
        expect(routeFor(routes, '/context')).toBe(routes[3]!);
        expect(routeFor(routes, '/context/list')).toBe(routes[3]!);
    });

    test('takes the first route in the table that answers', () => {
        const first: Route<unknown> = { below: '/a', handle: answer };
        const second: Route<unknown> = { exact: ['/a/b'], handle: answer };
        expect(routeFor([first, second], '/a/b')).toBe(first);
    });
});
