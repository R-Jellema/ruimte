import { describe, expect, mock, test } from 'bun:test';

// The real commands reach the whole workspace; one stand-in shows whether the click got through.
const ran: string[] = [];
mock.module('@/shell/commands', () => ({
    appCommands: () => [{ id: 'open-folder', run: () => ran.push('open-folder') }]
}));

const { runPaletteCommand } = await import('./actions');

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
});
