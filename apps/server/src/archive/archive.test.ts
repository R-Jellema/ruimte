import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { ARCHIVE_LIST_MAX_ENTRIES, BYTES_READ_MAX_BYTES } from '@ruimte/contracts';
import { listArchive, openArchive, readArchiveEntry } from './archive.ts';
import { buildTar, buildZip } from './test-archives.ts';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

let folder: string;

beforeAll(async () => {
    folder = await mkdtemp(join(tmpdir(), 'ruimte-archive-'));
});

afterAll(async () => {
    await rm(folder, { recursive: true, force: true });
});

async function put(name: string, bytes: Uint8Array): Promise<string> {
    const path = join(folder, name);
    await writeFile(path, bytes);
    return path;
}

/* A gzip whose header keeps the name of the file it was made from, the way `gzip` writes it. */
function gzipNamed(name: string, data: string): Buffer {
    const plain = gzipSync(data);
    plain[3] = plain[3]! | 0x08;
    return Buffer.concat([plain.subarray(0, 10), Buffer.from(`${name}\0`, 'latin1'), plain.subarray(10)]);
}

describe('telling archives apart', () => {
    test('by their bytes, not their names', async () => {
        expect((await openArchive(await put('a.bin', buildZip([{ name: 'x' }])))).format).toBe('zip');
        expect((await openArchive(await put('b.bin', buildTar([{ name: 'x' }])))).format).toBe('tar');
        expect((await openArchive(await put('c.bin', gzipSync(buildTar([{ name: 'x' }]))))).format).toBe('tar-gzip');
        expect(await openArchive(await put('d.bin', gzipSync('just text')))).toMatchObject({ format: 'gzip' });
        await expect(openArchive(await put('e.zip', new TextEncoder().encode('not a zip')))).rejects.toMatchObject({ code: 'not-an-archive' });
    });
});

describe('listing an archive', () => {
    test('names each entry once, leaves out the names that could escape and counts them', async () => {
        const path = await put(
            'mixed.zip',
            buildZip([
                { name: 'src/' },
                { name: 'src/a.ts', data: 'export {};' },
                { name: '../evil.sh', data: 'rm -rf ~' },
                { name: '/etc/passwd', data: 'root' },
                { name: 'src/a.ts', data: 'the second one' },
                { name: 'link', data: 'src', method: 0, mode: 0o120777 },
                { name: 'secret', data: 'x', encrypted: true }
            ])
        );
        const listed = await listArchive(path);
        expect(listed).toMatchObject({ format: 'zip', truncated: false, unsafe: 2 });
        expect(listed.entries.map((entry) => [entry.path, entry.kind, entry.readable])).toEqual([
            ['src', 'directory', true],
            ['src/a.ts', 'file', true],
            ['link', 'symlink', false],
            ['secret', 'file', false]
        ]);
        expect(listed.entries[1]).toMatchObject({ size: 10, compressedSize: expect.any(Number) });
    });

    test('stops at the cap and says the listing is cut short', async () => {
        const entries = Array.from({ length: ARCHIVE_LIST_MAX_ENTRIES + 5 }, (_, i) => ({ name: `f${i}`, method: 0 }));
        const listed = await listArchive(await put('many.zip', buildZip(entries)));
        expect(listed.entries).toHaveLength(ARCHIVE_LIST_MAX_ENTRIES);
        expect(listed.truncated).toBe(true);
    });

    test('lists a compressed tar by reading it from the start, and skips the top folder', async () => {
        const path = await put(
            'site.tgz',
            gzipSync(
                buildTar([
                    { name: './', type: '5' },
                    { name: './index.html', data: '<p>hi</p>' },
                    { name: './assets/', type: '5' }
                ])
            )
        );
        const listed = await listArchive(path);
        expect(listed.format).toBe('tar-gzip');
        expect(listed.unsafe).toBe(0);
        expect(listed.entries.map((entry) => entry.path)).toEqual(['index.html', 'assets']);
    });

    test('a gzip of one file lists that file under the name its header keeps, or its own name without .gz', async () => {
        const named = await listArchive(await put('kept.gz', gzipNamed('report.csv', 'a,b\n1,2\n')));
        expect(named.entries).toEqual([expect.objectContaining({ path: 'report.csv', kind: 'file', size: 8, readable: true })]);
        const unnamed = await listArchive(await put('server.log.gz', gzipSync('one line\n')));
        expect(unnamed.entries.map((entry) => entry.path)).toEqual(['server.log']);
        const escaping = await listArchive(await put('odd.gz', gzipNamed('../../etc/passwd', 'x')));
        expect(escaping.entries.map((entry) => entry.path)).toEqual(['passwd']);
    });

    test('a corrupt archive says so', async () => {
        const bytes = buildZip([{ name: 'a', data: 'a' }]);
        await expect(listArchive(await put('cut.zip', bytes.subarray(0, bytes.length - 10)))).rejects.toMatchObject({ code: 'corrupt' });
    });
});

describe('reading one entry', () => {
    test('hands it out with the mime its own bytes claim and a language for text', async () => {
        const path = await put(
            'mixed2.zip',
            buildZip([
                { name: 'img/logo.png', data: PNG },
                { name: 'src/main.ts', data: 'export {};\n' },
                { name: 'blob', data: new Uint8Array([0, 1, 2]) }
            ])
        );
        expect(await readArchiveEntry(path, 'img/logo.png')).toMatchObject({ mime: 'image/png' });
        const code = await readArchiveEntry(path, 'src/main.ts');
        expect(code).toMatchObject({ mime: 'text/plain; charset=utf-8', language: 'typescript' });
        expect(new TextDecoder().decode(code.bytes)).toBe('export {};\n');
        expect(await readArchiveEntry(path, 'blob')).toMatchObject({ mime: 'application/octet-stream' });
    });

    test('reads an entry out of a compressed tar and out of a gzip of one file', async () => {
        const tgz = await put(
            'two.tar.gz',
            gzipSync(
                buildTar([
                    { name: 'a.txt', data: 'first' },
                    { name: 'b.txt', data: 'second' }
                ])
            )
        );
        expect(new TextDecoder().decode((await readArchiveEntry(tgz, 'b.txt')).bytes)).toBe('second');
        const gz = await put('notes.md.gz', gzipSync('# Notes'));
        expect(new TextDecoder().decode((await readArchiveEntry(gz, 'notes.md')).bytes)).toBe('# Notes');
    });

    test('refuses a folder, a link, an encrypted entry and a name that is not there', async () => {
        const path = await put(
            'refusals.zip',
            buildZip([{ name: 'docs/' }, { name: 'link', data: 'docs', method: 0, mode: 0o120777 }, { name: 'secret', data: 'x', encrypted: true }])
        );
        await expect(readArchiveEntry(path, 'docs')).rejects.toMatchObject({ code: 'not-readable' });
        await expect(readArchiveEntry(path, 'link')).rejects.toMatchObject({ code: 'not-readable' });
        await expect(readArchiveEntry(path, 'secret')).rejects.toMatchObject({ code: 'not-readable' });
        await expect(readArchiveEntry(path, 'missing')).rejects.toMatchObject({ code: 'entry-not-found' });
    });

    test('refuses an entry past the preview cap before unpacking it', async () => {
        const path = await put('claims.zip', buildZip([{ name: 'huge.bin', data: 'small', declaredSize: BYTES_READ_MAX_BYTES + 1 }]));
        await expect(readArchiveEntry(path, 'huge.bin')).rejects.toMatchObject({ code: 'entry-too-large' });
    });

    test('refuses a tar entry past the preview cap', async () => {
        const path = await put('big.tgz', gzipSync(buildTar([{ name: 'zeros.bin', data: new Uint8Array(BYTES_READ_MAX_BYTES + 512) }])));
        await expect(readArchiveEntry(path, 'zeros.bin')).rejects.toMatchObject({ code: 'entry-too-large' });
    });

    test('reads a tar entry that lies past the first preview cap of the stream', async () => {
        const path = await put(
            'late.tar',
            buildTar([
                { name: 'first.bin', data: new Uint8Array(BYTES_READ_MAX_BYTES + 512) },
                { name: 'late.txt', data: 'late' }
            ])
        );
        expect(new TextDecoder().decode((await readArchiveEntry(path, 'late.txt')).bytes)).toBe('late');
    });

    test('stops a zip bomb while it inflates, whatever the header claims', async () => {
        const path = await put('bomb.zip', buildZip([{ name: 'zeros.bin', data: new Uint8Array(20 * 1024 * 1024) }]));
        await expect(readArchiveEntry(path, 'zeros.bin')).rejects.toMatchObject({ code: 'too-compressed' });
    });
});
