/*
 * The platforms the `ruimte` package ships a binary for, one `@ruimte/<os>-<cpu>` package each. The
 * names are Node's `process.platform` and `process.arch`, which are also what npm's `os` and `cpu` read.
 */
export interface Target {
    os: 'darwin' | 'linux' | 'win32';
    cpu: 'arm64' | 'x64';
}

export const TARGETS: readonly Target[] = [
    // Apple silicon only: an Intel Mac gets no build.
    { os: 'darwin', cpu: 'arm64' },
    { os: 'linux', cpu: 'x64' },
    { os: 'linux', cpu: 'arm64' },
    { os: 'win32', cpu: 'x64' }
];

export const LAUNCHER_NAME = 'ruimte';

/* `darwin-arm64`: the folder a build lands in and the second half of the package name. */
export function targetId(target: Target): string {
    return `${target.os}-${target.cpu}`;
}

export function packageNameOf(target: Target): string {
    return `@ruimte/${targetId(target)}`;
}

/* The file name of the daemon inside a platform package, which `compile.ts` gives the `.exe` Windows needs to run it. */
export function binaryNameOf(os: string): string {
    return os === 'win32' ? 'ruimte.exe' : 'ruimte';
}
