import { describe, expect, test } from 'bun:test';
import { FoldPanelMonitor, panelOfAngle, panelOfLine, type FoldPanel, type LogProcess } from './fold-panel.ts';

/* Lines in the shape of SpringBoard's compact log; the words around the token differ by release. */
const COVER = '2026-10-15 09:41:00.120 Df SpringBoard[812:5521] [com.apple.SpringBoard:DisplayContentMode] modes changed: <main.cover:pri>';
const INNER = '2026-10-15 09:41:02.884 Df SpringBoard[812:5521] [com.apple.SpringBoard:DisplayContentMode] modes changed: <main.inner:pri>';

function logOf(lines: readonly string[]): LogProcess & { killed: boolean } {
    let exit: (code: number) => void = () => undefined;
    const process = {
        killed: false,
        lines: (async function* () {
            yield* lines;
        })(),
        exited: new Promise<number>((resolve) => {
            exit = resolve;
        }),
        kill: () => {
            process.killed = true;
            exit(143);
        }
    };
    // A log command ends by itself once its lines are out, as `log show` does and a stream that died does.
    queueMicrotask(() => exit(0));
    return process;
}

describe('panelOfLine', () => {
    test('reads the primary panel from a SpringBoard line and nothing from any other', () => {
        expect(panelOfLine(COVER)).toBe('cover');
        expect(panelOfLine(INNER)).toBe('inner');
        expect(panelOfLine('2026-10-15 09:41:03.000 Df SpringBoard[812:5521] [com.apple.SpringBoard:DisplayContentMode] layout settled')).toBeNull();
    });

    test('takes the angle as the panel until SpringBoard says', () => {
        expect(panelOfAngle(0)).toBe('cover');
        expect(panelOfAngle(80)).toBe('cover');
        expect(panelOfAngle(90)).toBe('inner');
        expect(panelOfAngle(180)).toBe('inner');
    });
});

describe('FoldPanelMonitor', () => {
    test('reports the last panel of this boot, then every one the stream names, and starts a stream that died again', async () => {
        const commands: string[][] = [];
        const panels: FoldPanel[] = [];
        const logs = [logOf([COVER, INNER, COVER]), logOf([INNER]), logOf([])];
        let waits = 0;
        let finished: Promise<void> = Promise.resolve();
        let monitor: FoldPanelMonitor | null = null;
        monitor = new FoldPanelMonitor({
            udid: 'duo-1',
            onPanel: (panel) => panels.push(panel),
            spawn: (command) => {
                commands.push([...command]);
                return logs.shift() ?? logOf([]);
            },
            wait: async () => {
                waits += 1;
                if (waits === 2) {
                    finished = monitor!.stop();
                }
            }
        });

        monitor.start();
        for (let turn = 0; turn < 50 && waits < 2; turn += 1) {
            await Promise.resolve();
        }
        await finished;

        expect(panels).toEqual(['cover', 'inner']);
        expect(commands[0]).toEqual([
            'xcrun',
            'simctl',
            'spawn',
            'duo-1',
            'log',
            'show',
            '--last',
            'boot',
            '--style',
            'compact',
            '--predicate',
            'process == "SpringBoard" AND category == "DisplayContentMode"'
        ]);
        expect(commands[1]!.slice(4, 6)).toEqual(['log', 'stream']);
    });

    test('a stop ends the stream it follows and starts nothing after', async () => {
        const running = logOf([]);
        const panels: FoldPanel[] = [];
        let spawned = 0;
        const monitor = new FoldPanelMonitor({
            udid: 'duo-1',
            onPanel: (panel) => panels.push(panel),
            spawn: () => {
                spawned += 1;
                return running;
            },
            wait: async () => undefined
        });

        await monitor.stop();
        monitor.start();

        expect(spawned).toBe(0);
        expect(panels).toEqual([]);

        const live = Promise.withResolvers<void>();
        const streaming = Promise.withResolvers<void>();
        let killed = 0;
        let waits = 0;
        const active = new FoldPanelMonitor({
            udid: 'duo-1',
            onPanel: (panel) => panels.push(panel),
            spawn: (command) => {
                spawned += 1;
                if (command.includes('show')) {
                    return logOf([COVER]);
                }
                return {
                    lines: (async function* () {
                        streaming.resolve();
                        await live.promise;
                        yield* [];
                    })(),
                    exited: live.promise.then(() => 143),
                    kill: () => {
                        killed += 1;
                        live.resolve();
                    }
                };
            },
            wait: async () => {
                waits += 1;
            }
        });
        try {
            active.start();
            await streaming.promise;
            expect(spawned).toBe(2);
            const stopping = active.stop();
            expect(killed).toBe(1);
            await stopping;
            expect(waits).toBe(0);
            active.start();
            await Promise.resolve();
            expect(spawned).toBe(2);
        } finally {
            live.resolve();
            await active.stop();
        }
    });
});
