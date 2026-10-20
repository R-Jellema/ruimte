/*
 * Puts a folder in front of an environment's PATH. Windows separates entries with `;` and often names
 * the variable `Path`; a second `PATH` beside it would leave the child to pick one of the two.
 */
export function prependPath(env: Record<string, string | undefined>, directory: string, platform: string = process.platform): void {
    if (platform !== 'win32') {
        env.PATH = env.PATH ? `${directory}:${env.PATH}` : directory;
        return;
    }
    const key = Object.keys(env).find((name) => name.toUpperCase() === 'PATH') ?? 'PATH';
    const current = env[key];
    env[key] = current ? `${directory};${current}` : directory;
}
