import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { withBrowserFixture } from '../../testing/browser-fixture';

const BORDER_COLUMN = '\x1b[30G║';
// A program that draws a frame moves to the border's column, so the cells after a wide character stay where it put them.
const OUTPUT =
    ['╔══ 日本語 ══', 'fire \u{1f525} heart ❤️', 'family \u{1f468}‍\u{1f469}‍\u{1f467} \u{1f1f3}\u{1f1f1}', 'ab漢字cd \u{1f600}\u{1f600}', 'rocket \u{1f680} ok']
        .map((line) => `${line}${BORDER_COLUMN}`)
        .join('\r\n') + '\r\nprompt \u{1f680}';

const GRID = { cols: 60, rows: 20 };

interface Cells {
    rows: string[];
    cursor: { x: number; y: number };
}

/* What the daemon's emulator holds for the same bytes at the same grid, in the test process. */
async function daemonCells(cols: number, rows: number): Promise<Cells> {
    const serverDirectory = join(import.meta.dir, '../../../server');
    const { Terminal } = await import(Bun.resolveSync('@xterm/headless', serverDirectory));
    const { Unicode11Addon } = await import(Bun.resolveSync('@xterm/addon-unicode11', serverDirectory));
    const terminal = new Terminal({ cols, rows, scrollback: 1000, allowProposedApi: true });
    terminal.loadAddon(new Unicode11Addon());
    terminal.unicode.activeVersion = '11';
    await new Promise<void>((resolve) => terminal.write(OUTPUT, resolve));
    const buffer = terminal.buffer.active;
    const lines: string[] = [];
    for (let i = 0; i < buffer.length; i++) {
        lines.push(buffer.getLine(i)?.translateToString(true) ?? '');
    }
    return { rows: lines, cursor: { x: buffer.cursorX, y: buffer.cursorY } };
}

/*
 * The daemon's screen and the live stream only agree when both sides measure alike, so a client
 * terminal after `matchDaemonWidths` has to show the daemon's cells for the same bytes.
 */
test('a client terminal holds the same cells as the daemon for the same bytes at the same grid', async () => {
    await withBrowserFixture(
        `
        import { TerminalView } from ${JSON.stringify(Bun.resolveSync('@adecore/terminal', join(import.meta.dir, '../..')))};
        import { matchDaemonWidths } from ${JSON.stringify(join(import.meta.dir, 'unicode.ts'))};
        window.view = null;
        window.cells = () => {
            const buffer = window.view.terminal.buffer.active;
            const rows = [];
            for (let i = 0; i < buffer.length; i++) {
                rows.push(buffer.getLine(i)?.translateToString(true) ?? '');
            }
            return { rows, cursor: { x: buffer.cursorX, y: buffer.cursorY } };
        };
        function Probe() {
            const ref = React.useRef(null);
            React.useEffect(() => {
                window.view = ref.current;
                matchDaemonWidths(ref.current.terminal);
            }, []);
            return <TerminalView ref={ref} className="absolute inset-0" />;
        }
        createRoot(document.getElementById('root')).render(<UIProvider i18n={i18next}><Probe /></UIProvider>);
        `,
        `html,body,#root{margin:0;width:100%;height:100%}.absolute{position:absolute}.inset-0{inset:0}`,
        async (view) => {
            await view.evaluate<unknown>(
                'new Promise(resolve => { const check = () => (window.view !== null ? resolve() : requestAnimationFrame(check)); check(); })'
            );
            // The grid a client claims on attach, which is not the one its host would fit.
            await view.evaluate<unknown>(`window.view.terminal.resize(${GRID.cols}, ${GRID.rows})`);
            await view.evaluate<unknown>(`new Promise(resolve => window.view.terminal.write(${JSON.stringify(OUTPUT)}, resolve))`);
            const cells = await view.evaluate<Cells>('window.cells()');
            const daemon = await daemonCells(GRID.cols, GRID.rows);
            expect(cells.rows.slice(0, daemon.rows.length)).toEqual(daemon.rows);
            expect(cells.cursor).toEqual(daemon.cursor);
        }
    );
});
