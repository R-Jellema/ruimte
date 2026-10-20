import { describe, expect, test } from 'bun:test';
import { prependPath } from './env-path.ts';

describe('prependPath', () => {
    test('joins with a colon on macOS and Linux', () => {
        const env: Record<string, string | undefined> = { PATH: '/usr/bin' };
        prependPath(env, '/opt/ruimte', 'linux');
        expect(env).toEqual({ PATH: '/opt/ruimte:/usr/bin' });
    });

    test('joins with a semicolon on Windows and keeps the name the variable had', () => {
        const env: Record<string, string | undefined> = { Path: String.raw`C:\Windows` };
        prependPath(env, String.raw`C:\Ruimte\bin`, 'win32');
        expect(env).toEqual({ Path: String.raw`C:\Ruimte\bin;C:\Windows` });
    });

    test('starts a PATH when there is none', () => {
        const env: Record<string, string | undefined> = {};
        prependPath(env, String.raw`C:\Ruimte\bin`, 'win32');
        expect(env).toEqual({ PATH: String.raw`C:\Ruimte\bin` });
    });
});
