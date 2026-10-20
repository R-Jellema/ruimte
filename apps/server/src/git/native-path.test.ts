import { describe, expect, test } from 'bun:test';
import { nativePath } from './native-path.ts';

describe('nativePath', () => {
    test('turns the forward slashes git writes on Windows into backslashes', () => {
        expect(nativePath('C:/x/y', 'win32')).toBe('C:\\x\\y');
    });

    test('leaves a path already in Windows form alone', () => {
        expect(nativePath('C:\\x\\y', 'win32')).toBe('C:\\x\\y');
    });

    test('turns a relative path git writes into the Windows form too', () => {
        expect(nativePath('.git/MERGE_HEAD', 'win32')).toBe('.git\\MERGE_HEAD');
    });

    test('is the identity on POSIX', () => {
        expect(nativePath('/x/y', 'darwin')).toBe('/x/y');
        expect(nativePath('/x/y', 'linux')).toBe('/x/y');
    });
});
