import { spyOn } from 'bun:test';

export const CONTEXT_ENV = { RUIMTE_CONTEXT_URL: 'http://daemon.test/context', RUIMTE_CONTEXT_TOKEN: 'tok' };

/* Sends the CLI's requests to a route in this process and collects what it prints; `restore` puts the real ones back. */
export function routeContextCli(route: (request: Request, pathname: string) => Promise<Response> | Response): {
    output: { stdout: string; stderr: string };
    restore(): void;
} {
    const output = { stdout: '', stderr: '' };
    const spies = [
        spyOn(globalThis, 'fetch').mockImplementation(((input: string | URL | Request, init?: RequestInit) => {
            const request = new Request(input, init);

            return route(request, new URL(request.url).pathname);
        }) as typeof fetch),
        spyOn(process.stdout, 'write').mockImplementation((chunk) => {
            output.stdout += String(chunk);

            return true;
        }),
        spyOn(process.stderr, 'write').mockImplementation((chunk) => {
            output.stderr += String(chunk);

            return true;
        }),
        spyOn(console, 'log').mockImplementation((...parts) => {
            output.stdout += `${parts.join(' ')}\n`;
        })
    ];

    return {
        output,
        restore: () => {
            for (const spy of spies) {
                spy.mockRestore();
            }
        }
    };
}
