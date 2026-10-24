import { describe, expect, test } from 'bun:test';
import { filesRootOf } from './files-root';

const FOLDER = '/work/atlas';
const LEXER = { path: '/home/.ruimte/worktrees/atlas/lexer', branch: 'lexer' };

describe('filesRootOf', () => {
    test('stands in the project folder until a worktree is picked', () => {
        expect(filesRootOf(FOLDER, null, [LEXER])).toEqual({ root: FOLDER, worktree: null });
    });

    test('stands in the picked worktree while the machine lists it', () => {
        expect(filesRootOf(FOLDER, LEXER.path, [LEXER])).toEqual({ root: LEXER.path, worktree: LEXER });
    });

    test('falls back to the project once the worktree is gone or its folder is', () => {
        expect(filesRootOf(FOLDER, LEXER.path, [])).toEqual({ root: FOLDER, worktree: null });
        expect(filesRootOf(FOLDER, LEXER.path, [{ ...LEXER, missing: true }])).toEqual({ root: FOLDER, worktree: null });
    });
});
