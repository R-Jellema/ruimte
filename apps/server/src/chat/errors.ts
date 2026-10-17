import { ChatError as AgentChatError, type ChatErrorCode } from '@adecore/agents/chat';

type RuimteChatErrorCode =
    | ChatErrorCode
    // What a fork is refused with.
    | 'turn-running'
    | 'provider-not-installed'
    | 'not-on-a-canvas'
    | 'canvas-full'
    | 'not-a-repository'
    | 'branch-exists'
    | 'worktree-failed'
    | 'checkpoint-missing'
    // What only an agent's fork is refused with.
    | 'not-a-chat'
    | 'no-turn'
    // What a summary is refused with.
    | 'not-a-fork'
    | 'original-gone'
    // What going on under another account after a limit is refused with.
    | 'not-limited'
    | 'same-account'
    // What moving a chat out of Chats is refused with; each leaves the chat where it was.
    | 'move-refused'
    | 'files-conflict'
    | 'move-failed';

export class ChatError extends AgentChatError<RuimteChatErrorCode> {}
