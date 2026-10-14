import { COMMANDS, isCommandId } from '@/shell/command-table';

/* The palette and menu row that shows the pull request of one repository of a folder that holds several. */
export const PR_SHOW_IN_PREFIX = 'pr-show-in-';

/* The palette rows that exist once per agent CLI, layout or target view, and the menu's own row per view. */
export const PALETTE_PREFIXES = [
    PR_SHOW_IN_PREFIX,
    'agent-chat-',
    'agent-terminal-',
    'agent-view-chat-',
    'agent-view-terminal-',
    'layout-apply-',
    'layout-delete-',
    'view-move-'
] as const;

export const GO_VIEW_PREFIX = 'go-view-';

/* The Move to Project submenu's row per recent project, which moves the chat on screen there. */
export const CHAT_MOVE_PREFIX = 'chat-move-project-';

/* The Run menu's row per launch, which puts that launch on the chip. */
export const LAUNCH_CHOOSE_PREFIX = 'launch-choose-';

/* The Run menu's row per task that may run after a worktree chat settles. */
export const AFTER_SETTLE_PREFIX = 'launch-after-settle-';

/* A row the palette runs: one of the command table's it has, or one it makes per agent, layout or view. */
export function isPaletteId(id: string): boolean {
    return (isCommandId(id) && COMMANDS[id].palette) || PALETTE_PREFIXES.some((prefix) => id.startsWith(prefix));
}
