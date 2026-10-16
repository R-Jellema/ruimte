import { describe, expect, test } from 'bun:test';
import { namesTop, safeEntryPath, selects } from './entry-path.ts';

describe('an entry name', () => {
    test('becomes a relative path with forward slashes', () => {
        expect(safeEntryPath('src/main.ts')).toBe('src/main.ts');
        expect(safeEntryPath('src\\win\\main.ts')).toBe('src/win/main.ts');
        expect(safeEntryPath('./src//main.ts/')).toBe('src/main.ts');
        expect(safeEntryPath('docs/')).toBe('docs');
    });

    test('that could land outside the folder it is extracted into is refused', () => {
        for (const name of [
            '../evil.sh',
            'a/../../evil.sh',
            'a/..',
            '..\\..\\windows\\evil.dll',
            '/etc/passwd',
            '\\\\server\\share\\x',
            'C:\\Windows\\evil.dll',
            'c:evil',
            'a\0b',
            '',
            '.',
            './/'
        ]) {
            expect(safeEntryPath(name)).toBeNull();
        }
        expect(safeEntryPath('x'.repeat(5000))).toBeNull();
    });

    test('a name with dots that are no parent folder is fine', () => {
        expect(safeEntryPath('..hidden/...')).toBe('..hidden/...');
        expect(safeEntryPath('a/.config')).toBe('a/.config');
    });

    test('the top folder a tar writes first is its own case', () => {
        expect(namesTop('./')).toBe(true);
        expect(namesTop('.')).toBe(true);
        expect(namesTop('./a')).toBe(false);
        expect(namesTop('..')).toBe(false);
    });

    test('a folder selects everything under it and nothing that only starts with its name', () => {
        expect(selects('docs', 'docs')).toBe(true);
        expect(selects('docs', 'docs/a.md')).toBe(true);
        expect(selects('docs', 'docs-old/a.md')).toBe(false);
    });
});
