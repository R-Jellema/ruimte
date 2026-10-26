export interface CommandResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}

interface PipedChild {
    exited: Promise<number>;
    stdout: ReadableStream<Uint8Array>;
    stderr: ReadableStream<Uint8Array>;
}

/* Waits for a child spawned with both outputs piped, and reads them whole. */
export async function collect(child: PipedChild): Promise<CommandResult> {
    const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    return { exitCode, stdout, stderr };
}

/* Runs a command to its end with no input. */
export function runCommand(command: string[]): Promise<CommandResult> {
    return collect(Bun.spawn(command, { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' }));
}
