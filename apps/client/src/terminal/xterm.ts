import type { Terminal } from '@xterm/xterm';
import type { TerminalSize, TerminalViewHandle } from '@adecore/terminal';
import { isApplePlatform } from '@/desktop/bridge';
import { isAppShortcut, isClearShortcut, isLeaveNodeShortcut, isTerminalPaste, macMotionSequence } from '@/terminal/keymap';

/* ESC CR: what agent CLIs read as "newline, do not submit". Harmless in a plain shell. */
const SHIFT_ENTER = '\x1b\r';

const keyedTerminals = new WeakSet<Element>();

interface TerminalKeys {
    write(data: string): void;
    clear(): void;
    /* Whether the leave shortcut hands Escape back to the window, which a node on a canvas does and a terminal in a dialog does not. */
    leaves: boolean;
}

/*
 * The keys a terminal takes before xterm does, the same in a node and in a dialog. A focused terminal
 * has the keyboard the way a native one does: every shortcut the app does not need to move between
 * views stops here instead of reaching the window listeners. The ones it does need are the window's
 * alone, or xterm would write Cmd+Shift+Enter as a return.
 */
export function bindTerminalKeys(term: Terminal, keys: TerminalKeys): void {
    if (term.element) {
        keyedTerminals.add(term.element);
    }
    term.attachCustomKeyEventHandler((e) => {
        const apple = isApplePlatform();
        if (e.key === 'Escape') {
            // Escape is the program's (an interrupt, a mode change); only the leave shortcut returns
            // to the canvas, and it does so by falling through to the window listener unwritten.
            if (keys.leaves && isLeaveNodeShortcut(e, apple)) {
                return false;
            }
            // The canvas and a dialog listen above, where any Escape would clear the selection or close it.
            e.stopPropagation();
            return true;
        }
        if (isAppShortcut(e, apple)) {
            return false;
        }
        e.stopPropagation();
        if (e.type !== 'keydown') {
            return true;
        }
        if (isClearShortcut(e, apple)) {
            e.preventDefault();
            keys.clear();
            return false;
        }
        // Neither written nor prevented, so the browser's own paste lands in xterm's textarea.
        if (isTerminalPaste(e, apple)) {
            return false;
        }
        if (apple) {
            const motion = macMotionSequence(e, term.modes.applicationCursorKeysMode);
            if (motion) {
                e.preventDefault();
                keys.write(motion);
                return false;
            }
        }
        if (e.key === 'Enter' && e.shiftKey) {
            e.preventDefault();
            keys.write(SHIFT_ENTER);
            return false;
        }
        return true;
    });
}

/* Whether the keyboard is in a terminal that takes its own keys, where the clear key clears instead of opening the palette. */
export function terminalHasKeyboard(): boolean {
    if (typeof document === 'undefined') {
        return false;
    }
    for (let node = document.activeElement; node !== null; node = node.parentElement) {
        if (keyedTerminals.has(node)) {
            return true;
        }
    }
    return false;
}

/* The grid the terminal fits its host to, or null while the layout has not given that host any room. */
export function fittedGrid(view: TerminalViewHandle): TerminalSize | null {
    const host = view.terminal?.element?.parentElement;
    if (!host || host.clientWidth === 0 || host.clientHeight === 0) {
        return null;
    }
    return view.size();
}
