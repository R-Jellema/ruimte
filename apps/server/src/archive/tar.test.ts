import { describe, expect, test } from 'bun:test';
import { ChunkReader } from './streams.ts';
import { isTarHeader, tarEntries, type TarHeader } from './tar.ts';
import { buildTar, paxRecord, tarHeader } from './test-archives.ts';

/* The tar in pieces of an awkward size, the way a gunzip hands it over. */
async function* pieces(bytes: Uint8Array, size = 100): AsyncGenerator<Uint8Array> {
    for (let at = 0; at < bytes.length; at += size) {
        yield bytes.subarray(at, at + size);
    }
}

async function read(bytes: Uint8Array): Promise<Array<TarHeader & { text: string | null }>> {
    const found: Array<TarHeader & { text: string | null }> = [];
    for await (const { header, body } of tarEntries(new ChunkReader(pieces(bytes)))) {
        let text: string | null = null;
        if (header.name.endsWith('.txt')) {
            const parts: Uint8Array[] = [];
            for await (const chunk of body()) {
                parts.push(chunk);
            }
            text = Buffer.concat(parts).toString('utf-8');
        }
        found.push({ ...header, text });
    }
    return found;
}

describe('the tar reader', () => {
    test('reads files, folders and links header by header, skipping what is not taken', async () => {
        const bytes = buildTar([
            { name: 'docs/', type: '5' },
            { name: 'docs/a.txt', data: 'alpha' },
            { name: 'docs/big.bin', data: new Uint8Array(1500) },
            { name: 'docs/b.txt', data: 'beta', mtime: 1_600_000_000 },
            { name: 'current', type: '2', linkName: 'docs' },
            { name: 'again', type: '1', linkName: 'docs/a.txt' }
        ]);
        const entries = await read(bytes);
        expect(entries.map((entry) => [entry.name, entry.kind, entry.size, entry.text])).toEqual([
            ['docs/', 'directory', 0, null],
            ['docs/a.txt', 'file', 5, 'alpha'],
            ['docs/big.bin', 'file', 1500, null],
            ['docs/b.txt', 'file', 4, 'beta'],
            ['current', 'symlink', 0, null],
            ['again', 'hardlink', 0, null]
        ]);
        expect(entries[3]!.mtime).toBe(1_600_000_000_000);
    });

    test('takes a long name from a GNU header, a pax header and the ustar prefix', async () => {
        const long = `${'deep/'.repeat(40)}file.txt`;
        const bytes = buildTar([
            { name: '././@LongLink', type: 'L', data: `${long}\0` },
            { name: long.slice(0, 99), data: 'gnu' },
            { name: 'PaxHeaders/x', type: 'x', data: paxRecord('path', 'pax/named.txt') + paxRecord('mtime', '1700000001.5') },
            { name: 'short', data: 'pax' },
            { name: 'name.txt', prefix: 'a/prefix/folder', data: 'ustar' }
        ]);
        const entries = await read(bytes);
        expect(entries.map((entry) => [entry.name, entry.text])).toEqual([
            [long, 'gnu'],
            ['pax/named.txt', 'pax'],
            ['a/prefix/folder/name.txt', 'ustar']
        ]);
        expect(entries[1]!.mtime).toBe(1_700_000_001_500);
    });

    test('a header whose checksum fails is a corrupt archive', async () => {
        const bytes = buildTar([{ name: 'a.txt', data: 'a', badChecksum: true }]);
        expect(isTarHeader(bytes.subarray(0, 512))).toBe(false);
        await expect(read(bytes)).rejects.toMatchObject({ code: 'corrupt' });
    });

    test('a tar that breaks off inside an entry is a corrupt archive', async () => {
        const bytes = buildTar([{ name: 'a.txt', data: 'x'.repeat(2000) }]).subarray(0, 1024);
        await expect(read(bytes)).rejects.toMatchObject({ code: 'corrupt' });
    });

    test('a header is told from any other block by its checksum', () => {
        expect(isTarHeader(tarHeader({ name: 'a' }))).toBe(true);
        expect(isTarHeader(new Uint8Array(512).fill(0x41))).toBe(false);
    });
});
