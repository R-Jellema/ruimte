import { describe, expect, it } from 'bun:test';
import { isToolchainKind, toolchainVersionOf } from './toolchain.ts';

describe('toolchain kinds', () => {
    it('knows rust as the one kind a toolchain brings', () => {
        expect(isToolchainKind('rust')).toBe(true);
        expect(isToolchainKind('php-native')).toBe(false);
    });

    it('reads the version a program names itself with, and nothing from a proxy without its component', () => {
        expect(toolchainVersionOf('rust-analyzer', ['rust-analyzer 1.85.0 (4d91de4e 2025-02-17)'])).toBe('1.85.0 (4d91de4e 2025-02-17)');
        expect(toolchainVersionOf('rust-analyzer', ["error: Unknown binary 'rust-analyzer' in official toolchain 'stable'."])).toBeNull();
        expect(toolchainVersionOf('rust-analyzer', [])).toBeNull();
    });
});
