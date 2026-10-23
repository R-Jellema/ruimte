import { describe, expect, mock, test } from 'bun:test';

// The real commands reach the whole workspace; one stand-in shows whether the click got through.
const ran: string[] = [];
let onRun: ((id: string) => void) | undefined;
const paletteIds = [
    'open-folder',
    'chat-make-project',
    'chat-move-to-project',
    'pr-show-in-/work/web',
    'agent-chat-claude',
    'agent-terminal-claude',
    'agent-view-chat-claude',
    'agent-view-terminal-claude',
    'layout-apply-Review',
    'layout-delete-Review',
    'view-move-other'
];
mock.module('@/shell/commands', () => ({
    appCommands: () =>
        paletteIds.map((id) => ({
            id,
            run: () => {
                ran.push(id);
                onRun?.(id);
            }
        }))
}));

const { runMenuCommand, runPaletteCommand } = await import('./actions');

describe('a palette command from the application menu', () => {
    test('runs once the commands are in, also when the click came first', async () => {
        ran.length = 0;
        const running = runPaletteCommand('open-folder');
        expect(ran).toEqual([]);
        await running;
        expect(ran).toEqual(['open-folder']);
    });

    test('an id no command has does nothing', async () => {
        ran.length = 0;
        await runPaletteCommand('no-such-command');
        expect(ran).toEqual([]);
    });

    test.each(paletteIds)('dispatches %s through the real menu route', async (id) => {
        ran.length = 0;
        const completed = Promise.withResolvers<string>();
        onRun = completed.resolve;
        try {
            runMenuCommand(id);
            expect(await completed.promise).toBe(id);
            expect(ran).toEqual([id]);
        } finally {
            onRun = undefined;
        }
    });
});
