import { describe, expect, test } from 'bun:test';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { shellQuote } from './detect.ts';
import { readVscodeLaunch } from './vscode.ts';

const ROOT = resolve('/work/passly');

function read(configurations: unknown[], compounds: unknown[] = []) {
    return readVscodeLaunch(JSON.stringify({ version: '0.2.0', configurations, compounds }), ROOT, ROOT);
}

function one(configuration: Record<string, unknown>) {
    return read([{ type: 'node', request: 'launch', name: 'Run', ...configuration }])[0]!;
}

describe('node launch configurations', () => {
    test('the program and its arguments become one command, quoted per token', () => {
        const built = one({ program: '${workspaceFolder}/src/index.js', args: ['--name', 'a b', '$HOME;rm', "it's"] });
        expect(built.launch.command).toBe("node src/index.js --name 'a b' '$HOME;rm' 'it'\\''s'");
        expect(built.unsupported).toBeUndefined();
        expect(built.detail).toBe('node');
    });

    test('a runtime executable and its arguments lead, and the script decides the kind', () => {
        const built = one({ name: 'Debug', runtimeExecutable: 'npm', runtimeArgs: ['run', 'dev'] });
        expect(built.launch).toMatchObject({ command: 'npm run dev', kind: 'service', cwd: ROOT });
        expect(one({ name: 'Debug', runtimeExecutable: 'npm', runtimeArgs: ['run', 'test'], type: 'pwa-node' }).launch.kind).toBe('task');
    });

    test('the working folder defaults to the root and follows the cwd setting', () => {
        expect(one({ program: 'a.js' }).launch.cwd).toBe(ROOT);
        expect(one({ program: 'a.js', cwd: '${workspaceFolder}/api' }).launch.cwd).toBe(join(ROOT, 'api'));
    });

    test('env values are read with their variables', () => {
        expect(one({ program: 'a.js', env: { DIR: '${workspaceFolder}/x', PORT: '3000' } }).launch.env).toEqual({ DIR: `${ROOT}/x`, PORT: '3000' });
    });

    test('the home folder makes the launch private', () => {
        const built = one({ program: '${userHome}/tool.js' });
        expect(built.outside).toBe(true);
        expect(built.launch.command).toBe(`node ${shellQuote(`${homedir()}/tool.js`)}`);
    });

    test('an executable inside the working folder keeps a path form instead of a PATH lookup', () => {
        expect(one({ program: 'a.js', runtimeExecutable: '${workspaceFolder}/tool' }).launch.command).toBe('./tool a.js');
        expect(one({ program: 'a.js', runtimeExecutable: '${workspaceFolder}/bin/tool' }).launch.command).toBe('bin/tool a.js');
        expect(one({ program: 'a.js', runtimeExecutable: 'npm' }).launch.command).toBe('npm a.js');
    });

    test('a machine path inside a token or an env value makes the launch private', () => {
        expect(one({ program: 'a.js' }).outside).toBe(false);
        expect(one({ program: 'a.js', args: ['--root=${workspaceFolder}/x'] }).outside).toBe(true);
        expect(one({ program: 'a.js', env: { DIR: '${workspaceFolder}/x' } }).outside).toBe(true);
        expect(one({ program: 'a.js', env: { HOME_DIR: '${userHome}' } }).outside).toBe(true);
        expect(one({ program: 'a.js', args: ['${pathSeparator}'] }).outside).toBe(false);
    });

    test.each([
        ['attach', { request: 'attach' }, 'attach'],
        ['preLaunchTask', { program: 'a.js', preLaunchTask: 'build' }, 'preLaunchTask'],
        ['postDebugTask', { program: 'a.js', postDebugTask: 'clean' }, 'postDebugTask'],
        ['envFile', { program: 'a.js', envFile: '.env' }, 'envFile'],
        ['an open-file variable', { program: '${file}' }, '${file}'],
        ['an environment variable', { program: 'a.js', args: ['${env:HOME}'] }, '${env:HOME}'],
        ['a null env value', { program: 'a.js', env: { A: null } }, 'env'],
        ['string args', { program: 'a.js', args: '--x' }, 'args'],
        ['a platform override', { program: 'a.js', osx: { args: [] } }, 'osx'],
        ['another type', { type: 'chrome', url: 'http://x' }, 'chrome']
    ])('%s comes back unsupported with its reason', (_label, configuration, reason) => {
        expect(one(configuration).unsupported).toBe(reason);
    });

    test('a compound is unsupported', () => {
        const built = read([], [{ name: 'All', configurations: ['A', 'B'] }]);
        expect(built).toMatchObject([{ launch: { name: 'All' }, unsupported: 'compound' }]);
    });

    test('comments in the file do not stop the read, and text that is not JSON gives nothing', () => {
        const text = '{ // c\n "configurations": [ { "type": "node", "request": "launch", "name": "A", "program": "a.js", }, ], }';
        expect(readVscodeLaunch(text, ROOT, ROOT)).toHaveLength(1);
        expect(readVscodeLaunch('nope', ROOT, ROOT)).toEqual([]);
    });
});
