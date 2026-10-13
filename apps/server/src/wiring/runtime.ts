import type { ServerConfig } from '../config.ts';

/* Where this daemon runs from and how it is reached, settled by `daemon.ts` before anything is wired. */
export interface DaemonRuntime {
    config: ServerConfig;
    compiled: boolean;
    /* The server's `src` folder; a wiring module's own `import.meta.dir` is not it. */
    sourceDir: string;
    /* Where `ruimte-context` lives, which goes on the PATH of every shell and chat. */
    binDir: string;
    contextUrl: string;
}
