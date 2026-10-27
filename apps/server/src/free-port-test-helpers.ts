/* A port nothing listens on at this moment, for a process the test starts on it. */
export async function freePort(): Promise<number> {
    const server = Bun.serve({ port: 0, fetch: () => new Response('') });
    const { port } = server;
    await server.stop(true);

    return port!;
}
