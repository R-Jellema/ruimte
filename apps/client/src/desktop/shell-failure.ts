/* What Electron makes of a handler that threw: a sentence about the channel that no person should read. */
export function isShellFailure(e: unknown): boolean {
    return e instanceof Error && e.message.startsWith('Error invoking remote method');
}
