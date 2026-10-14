import { Unicode11Addon } from '@xterm/addon-unicode11';
import type { Terminal } from '@xterm/xterm';

/*
 * The daemon measures with Unicode 11 (`apps/server/src/sessions/session.ts`), so every client has to
 * as well, or a screen from an attach lands on other cells than the live stream.
 */
export function matchDaemonWidths(term: Terminal): void {
    // Only `cols` and `rows` are constructor-only in xterm; the addon's version switch needs the proposed API.
    term.options.allowProposedApi = true;
    if (term.unicode.activeVersion === '11') {
        return;
    }
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = '11';
}
