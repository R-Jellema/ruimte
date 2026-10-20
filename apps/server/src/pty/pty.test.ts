import { describe, expect, test } from 'bun:test';
import { defaultShell, defaultShellArgs, shellName, signalExitCode } from './pty.ts';

describe('defaultShell', () => {
    test('prefers $SHELL', () => {
        expect(defaultShell({ SHELL: '/opt/fish' }, 'darwin')).toBe('/opt/fish');
    });

    test('falls back per platform when $SHELL is missing or blank', () => {
        expect(defaultShell({}, 'darwin')).toBe('/bin/zsh');
        expect(defaultShell({ SHELL: '  ' }, 'linux')).toBe('/bin/bash');
    });
});

describe('defaultShellArgs', () => {
    test('adds the login flag only for shells known to take it', () => {
        expect(defaultShellArgs('/bin/zsh')).toEqual(['-l']);
        expect(defaultShellArgs('/usr/local/bin/fish')).toEqual(['-l']);
        expect(defaultShellArgs('/usr/bin/nu')).toEqual([]);
    });
});

describe('signalExitCode', () => {
    test('reports a signal death the way shells do', () => {
        expect(signalExitCode('SIGKILL', { SIGKILL: 9 })).toBe(137);
        expect(signalExitCode('SIGWEIRD', {})).toBe(128);
    });
});

describe('defaultShell on Windows', () => {
    const bash = String.raw`C:\Program Files\Git\bin\bash.exe`;

    test('finds Git Bash beside the git on PATH', () => {
        const which = (program: string): string | null => (program === 'git' ? String.raw`D:\Tools\Git\cmd\git.exe` : null);
        const found = String.raw`D:\Tools\Git\bin\bash.exe`;
        expect(defaultShell({}, 'win32', which, (path) => path === found)).toBe(found);
    });

    test('finds Git Bash in Program Files without a git on PATH', () => {
        expect(
            defaultShell(
                { ProgramFiles: String.raw`C:\Program Files` },
                'win32',
                () => null,
                (path) => path === bash
            )
        ).toBe(bash);
    });

    test('falls back to PowerShell, then to the command prompt', () => {
        const powershell = String.raw`C:\Windows\powershell.exe`;
        const which = (program: string): string | null => (program === 'powershell' ? powershell : null);
        expect(defaultShell({}, 'win32', which, () => false)).toBe(powershell);
        const cmd = String.raw`C:\Windows\cmd.exe`;
        expect(
            defaultShell(
                { COMSPEC: cmd },
                'win32',
                () => null,
                () => false
            )
        ).toBe(cmd);
    });
});

describe('shellName', () => {
    test('drops the folder and the .exe of either platform', () => {
        const bash = String.raw`C:\Program Files\Git\bin\bash.exe`;
        expect(shellName('/bin/zsh')).toBe('zsh');
        expect(shellName(bash)).toBe('bash');
        expect(defaultShellArgs(bash)).toEqual(['-l']);
    });
});
