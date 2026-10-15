import type { ChatInfo } from '@ruimte/contracts';

/* An idle Claude chat that never ran a turn, whole, so a fake machine's events pass the schema a client checks them against. */
export function chatInfoOf(chatId: string, patch: Partial<ChatInfo> = {}): ChatInfo {
    return {
        chatId,
        provider: 'claude',
        cwd: '/work/atlas',
        agentSessionId: null,
        model: null,
        selection: { model: 'model', options: {} },
        runtimeMode: 'supervised',
        status: 'idle',
        running: false,
        activeTurnId: null,
        slashCommands: [],
        usage: { turns: 0, contextTokens: 0, contextWindow: 200_000, costUsd: 0 },
        background: [],
        createdAt: 0,
        ...patch
    };
}
