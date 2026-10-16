import { describe, expect, test } from 'bun:test';
import { ARCHIVE_SCAN_MAX_BYTES, ArchiveError, InflateMeter } from './limits.ts';
import type { RandomAccess } from './streams.ts';
import { buildZip } from './test-archives.ts';
import { readZipDirectory, zipEntryChunks, zipReadable, type ZipEntry } from './zip.ts';

function inMemory(bytes: Uint8Array): RandomAccess {
    return { size: bytes.length, read: async (offset, length) => bytes.subarray(offset, offset + length) };
}

function meter(): InflateMeter {
    return new InflateMeter(ARCHIVE_SCAN_MAX_BYTES, () => new ArchiveError('too-large', 'too large'));
}

async function text(file: RandomAccess, entry: ZipEntry): Promise<string> {
    const parts: Uint8Array[] = [];
    for await (const chunk of zipEntryChunks(file, entry, meter())) {
        parts.push(chunk);
    }
    return Buffer.concat(parts).toString('utf-8');
}

describe('the zip reader', () => {
    test('reads a stored and a deflated entry from the central directory', async () => {
        const file = inMemory(
            buildZip([
                { name: 'notes.txt', data: 'stored as is', method: 0 },
                { name: 'src/main.ts', data: 'export {};\n'.repeat(50) }
            ])
        );
        const { entries, truncated } = await readZipDirectory(file);
        expect(truncated).toBe(false);
        expect(entries.map((entry) => [entry.name, entry.method, entry.size])).toEqual([
            ['notes.txt', 0, 12],
            ['src/main.ts', 8, 550]
        ]);
        expect(await text(file, entries[0]!)).toBe('stored as is');
        expect(await text(file, entries[1]!)).toBe('export {};\n'.repeat(50));
        expect(entries[1]!.compressedSize).toBeLessThan(550);
    });

    test('takes every size and offset from the ZIP64 records', async () => {
        const file = inMemory(
            buildZip(
                [
                    { name: 'a.txt', data: 'first' },
                    { name: 'b.txt', data: 'second', method: 0 }
                ],
                { zip64: true }
            )
        );
        const { entries } = await readZipDirectory(file);
        expect(entries.map((entry) => [entry.name, entry.size])).toEqual([
            ['a.txt', 5],
            ['b.txt', 6]
        ]);
        expect(await text(file, entries[1]!)).toBe('second');
    });

    test('names folders and links, and marks an encrypted entry and an unknown method as not readable', async () => {
        const file = inMemory(
            buildZip([
                { name: 'docs/' },
                { name: 'current', data: 'docs', method: 0, mode: 0o120777 },
                { name: 'secret.txt', data: 'garbage', encrypted: true },
                { name: 'packed.bin', data: 'bzip2 bytes', method: 12 }
            ])
        );
        const { entries } = await readZipDirectory(file);
        expect(entries.map((entry) => [entry.name, entry.directory, entry.symlink, zipReadable(entry)])).toEqual([
            ['docs/', true, false, true],
            ['current', false, true, true],
            ['secret.txt', false, false, false],
            ['packed.bin', false, false, false]
        ]);
        await expect(text(file, entries[2]!)).rejects.toMatchObject({ code: 'not-readable' });
    });

    test('refuses an entry that unpacks to more than its header says', async () => {
        const file = inMemory(buildZip([{ name: 'small.txt', data: 'x'.repeat(10_000), declaredSize: 10 }]));
        const { entries } = await readZipDirectory(file);
        expect(entries[0]!.size).toBe(10);
        await expect(text(file, entries[0]!)).rejects.toMatchObject({ code: 'corrupt' });
    });

    test('refuses an entry whose bytes do not match its checksum', async () => {
        const bytes = buildZip([{ name: 'a.txt', data: 'abcdef', method: 0 }]);
        bytes[30 + 'a.txt'.length] = 'z'.charCodeAt(0);
        const file = inMemory(bytes);
        const { entries } = await readZipDirectory(file);
        await expect(text(file, entries[0]!)).rejects.toMatchObject({ code: 'corrupt' });
    });

    test('an empty zip is its end record alone', async () => {
        expect((await readZipDirectory(inMemory(buildZip([])))).entries).toEqual([]);
    });

    test('a file without an end record is no zip', async () => {
        await expect(readZipDirectory(inMemory(new TextEncoder().encode('PK\x03\x04 and then nothing')))).rejects.toMatchObject({ code: 'corrupt' });
    });

    test('stops at the cap it is given and says so', async () => {
        const file = inMemory(buildZip([{ name: 'a' }, { name: 'b' }, { name: 'c' }]));
        const { entries, truncated } = await readZipDirectory(file, 2);
        expect(entries.map((entry) => entry.name)).toEqual(['a', 'b']);
        expect(truncated).toBe(true);
    });
});
