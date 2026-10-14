import { expect, test } from 'bun:test';
import { Terminal } from '@xterm/xterm';
import { matchDaemonWidths } from '@/terminal/unicode';

test('a terminal built without the proposed API measures a rocket as two cells after matching the daemon', async () => {
    const term = new Terminal({ cols: 20, rows: 3 });
    matchDaemonWidths(term);
    expect(term.unicode.activeVersion).toBe('11');

    await new Promise<void>((resolve) => term.write('\u{1f680}x', resolve));
    expect(term.buffer.active.cursorX).toBe(3);
    term.dispose();
});

test('matching twice loads the addon once', () => {
    const term = new Terminal({ cols: 20, rows: 3 });
    matchDaemonWidths(term);
    matchDaemonWidths(term);
    expect(term.unicode.versions).toEqual(['6', '11']);
    term.dispose();
});
