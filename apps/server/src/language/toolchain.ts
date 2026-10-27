import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { LanguageServerKind } from '@ruimte/contracts';

/*
 * A kind whose server comes with a toolchain a person installs, and which Ruimte only finds: rust-analyzer
 * is a component of rustup, and has to match the toolchain a project builds with, so Ruimte pins no
 * version of it and downloads nothing. Install looks for it again, and says how to get it when it is not there.
 */
export type ToolchainKind = 'rust';

const TOOLCHAIN_KINDS: readonly ToolchainKind[] = ['rust'];

export function isToolchainKind(kind: LanguageServerKind): kind is ToolchainKind {
    return (TOOLCHAIN_KINDS as readonly string[]).includes(kind);
}

interface ToolchainSpec {
    program: string;
    /* What the language status says while the program is not on this machine. */
    missing: string;
}

const TOOLCHAINS: Record<ToolchainKind, ToolchainSpec> = {
    rust: {
        program: 'rust-analyzer',
        missing: 'rust-analyzer is not on this machine. It comes with the Rust toolchain: run rustup component add rust-analyzer'
    }
};

export function toolchainProgramOf(kind: ToolchainKind): string {
    return TOOLCHAINS[kind].program;
}

export function toolchainMissingOf(kind: ToolchainKind): string {
    return TOOLCHAINS[kind].missing;
}

/* rustup's own folder, which a daemon started by the desktop app or a service may not have on its PATH. */
export function cargoBin(): string {
    return join(homedir(), '.cargo', 'bin');
}

/* The PATH a toolchain's program runs with, so rust-analyzer finds cargo where rustup put it. */
export function toolchainPath(): string {
    return `${process.env.PATH ?? ''}${delimiter}${cargoBin()}`;
}

/* Where a program of a toolchain may be: on the PATH, else in rustup's own folder. */
export function toolchainCandidates(program: string): string[] {
    const onPath = Bun.which(program, { PATH: process.env.PATH ?? '' });
    return [...new Set([...(onPath === null ? [] : [onPath]), join(cargoBin(), program)])];
}

/* The version a program printed for `--version`, such as `1.85.0 (4d91de4e 2025-02-17)` out of `rust-analyzer 1.85.0 (4d91de4e 2025-02-17)`. */
export function toolchainVersionOf(program: string, lines: readonly string[]): string | null {
    const line = lines.map((text) => text.trim()).find((text) => text.startsWith(`${program} `));
    return line === undefined ? null : line.slice(program.length + 1).trim();
}
