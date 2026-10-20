import { expect, test } from 'bun:test';
import { binaryNameOf } from './targets';

test('the daemon carries .exe on Windows only', () => {
    expect(binaryNameOf('win32')).toBe('ruimte.exe');
    expect(binaryNameOf('darwin')).toBe('ruimte');
    expect(binaryNameOf('linux')).toBe('ruimte');
});
