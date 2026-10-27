import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ChatInfo } from '@ruimte/contracts';

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* The home the helper is handed with `--home`, from the environment a chat's CLI starts in. */
export function appleHomeOf(env: Record<string, string | undefined>): string {
    return env.RUIMTE_HOME ?? join(env.HOME ?? homedir(), '.ruimte');
}

/*
 * Removes the transcript and the lock the helper keeps for a chat (`SessionStore.swift`). An Apple
 * chat cannot be forked and no terminal runs the helper, so the chat is the only owner of its session.
 * Only called once the chat's helper ended, since that one holds the lock while it runs.
 */
export async function removeAppleSession(home: string, info: Pick<ChatInfo, 'provider' | 'agentSessionId'>): Promise<void> {
    if (info.provider !== 'apple' || info.agentSessionId === null || !SESSION_ID.test(info.agentSessionId)) {
        return;
    }
    const folder = join(home, 'apple-foundation', 'sessions');
    const id = info.agentSessionId.toLowerCase();
    await Promise.all([rm(join(folder, `${id}.json`), { force: true }), rm(join(folder, `${id}.lock`), { force: true })]);
}
