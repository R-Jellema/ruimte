import { describe, expect, test } from 'bun:test';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempHomes } from '../temp-home-test-helpers.ts';
import { appleHomeOf, removeAppleSession } from './apple-sessions.ts';

const SESSION = '0f8fad5b-d9cb-469f-a165-70867728950e';

const newHome = tempHomes('ruimte-apple-sessions-');

async function sessionsWith(home: string, names: string[]): Promise<string> {
    const folder = join(home, 'apple-foundation', 'sessions');
    await mkdir(folder, { recursive: true });
    await Promise.all(names.map((name) => writeFile(join(folder, name), '')));
    return folder;
}

describe('removeAppleSession', () => {
    test('removes the transcript and the lock of the session the chat names, and nothing else', async () => {
        const home = await newHome();
        const folder = await sessionsWith(home, [`${SESSION}.json`, `${SESSION}.lock`, 'other.json']);
        await removeAppleSession(home, { provider: 'apple', agentSessionId: SESSION.toUpperCase() });
        expect(await readdir(folder)).toEqual(['other.json']);
    });

    test('leaves the folder alone for another provider, no session or an id that is not one', async () => {
        const home = await newHome();
        const folder = await sessionsWith(home, [`${SESSION}.json`, '..json']);
        await removeAppleSession(home, { provider: 'claude', agentSessionId: SESSION });
        await removeAppleSession(home, { provider: 'apple', agentSessionId: null });
        await removeAppleSession(home, { provider: 'apple', agentSessionId: '.' });
        expect((await readdir(folder)).sort()).toEqual(['..json', `${SESSION}.json`]);
    });

    test('is done when the files are already gone', async () => {
        const home = await newHome();
        await expect(removeAppleSession(home, { provider: 'apple', agentSessionId: SESSION })).resolves.toBeUndefined();
    });
});

describe('appleHomeOf', () => {
    test('follows RUIMTE_HOME, and the default under HOME without it', () => {
        expect(appleHomeOf({ RUIMTE_HOME: '/data/ruimte', HOME: '/home/bas' })).toBe('/data/ruimte');
        expect(appleHomeOf({ HOME: '/home/bas' })).toBe(join('/home/bas', '.ruimte'));
    });
});
