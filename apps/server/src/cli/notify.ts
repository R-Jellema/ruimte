import { MACHINE_NOTIFY_PATH, MachineNotifyRefusalSchema } from '@ruimte/contracts';
import { readLocalSecret } from '../auth/local-secret.ts';
import { startFirst } from './machine-status.ts';

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export interface NotifyOptions {
    port: number;
    home: string;
    // `--node`; absent, the terminal of Ruimte the script runs in.
    node?: string;
    text: string;
    env?: Record<string, string | undefined>;
    fetch?: Fetch;
    readSecret?: (home: string) => Promise<string>;
    err?: (line: string) => void;
}

const MAX_TEXT = 500;

/*
 * `ruimte notify`: a script on this machine raises a notification the way an agent's `alert` does,
 * on the phones and in every window, and it opens the node it names. Only the local secret may.
 */
export async function runNotify(options: NotifyOptions): Promise<number> {
    const fetcher: Fetch = options.fetch ?? ((input, init) => fetch(input, init));
    const err = options.err ?? ((line: string) => console.error(line));
    const nodeId = options.node ?? (options.env ?? process.env).RUIMTE_SESSION_ID ?? '';
    const text = options.text.trim();
    if (nodeId === '') {
        err('Name the node the notification opens with --node <id>, or run it in a terminal of Ruimte.');
        return 1;
    }
    if (text === '' || text.length > MAX_TEXT) {
        err(`Usage: ruimte notify [--node <id>] <text>, with a text of at most ${MAX_TEXT} characters.`);
        return 1;
    }
    const secret = await (options.readSecret ?? readLocalSecret)(options.home).catch(() => null);
    if (secret === null) {
        err(`No local secret in ${options.home}: only a process of the person whose daemon has that home may notify. ${startFirst(options.port)}`);
        return 1;
    }
    const response = await fetcher(`http://127.0.0.1:${options.port}${MACHINE_NOTIFY_PATH}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
        body: JSON.stringify({ nodeId, text })
    }).catch(() => null);
    if (!response) {
        err(`No daemon answers on port ${options.port}. ${startFirst(options.port)}`);
        return 1;
    }
    if (response.status === 404) {
        err(`The daemon on port ${options.port} is older than \`ruimte notify\`; update it first.`);
        return 1;
    }
    if (response.status === 401 || response.status === 403) {
        err(`The daemon on port ${options.port} does not use ${options.home}; set RUIMTE_HOME to the home it was started with.`);
        return 1;
    }
    if (!response.ok) {
        const refusal = MachineNotifyRefusalSchema.safeParse(await response.json().catch(() => null));
        err(
            refusal.success && refusal.data.code === 'node-not-found'
                ? `No project here holds the node ${nodeId}.`
                : `The daemon refused the notification (${response.status}).`
        );
        return 1;
    }
    return 0;
}
