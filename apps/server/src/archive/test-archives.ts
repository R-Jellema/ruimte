import { crc32, deflateRawSync } from 'node:zlib';

/* Archives built byte by byte for the tests, so each one holds exactly the oddity a test is about. */

interface ZipFixtureEntry {
    name: string;
    data?: string | Uint8Array;
    method?: number;
    encrypted?: boolean;
    /* A Unix mode in the external attributes, which is also how a link is marked. */
    mode?: number;
    /* What the directory claims the entry unpacks to, when the test wants it to lie. */
    declaredSize?: number;
}

function bytesOf(data: string | Uint8Array | undefined): Uint8Array {
    return typeof data === 'string' ? new TextEncoder().encode(data) : (data ?? new Uint8Array(0));
}

/* A zip in the shape any tool writes; with `zip64` every size and offset is in the ZIP64 records instead. */
export function buildZip(entries: readonly ZipFixtureEntry[], options: { zip64?: boolean } = {}): Buffer {
    const zip64 = options.zip64 === true;
    const locals: Buffer[] = [];
    const centrals: Buffer[] = [];
    let offset = 0;
    for (const entry of entries) {
        const data = bytesOf(entry.data);
        const method = entry.method ?? 8;
        const compressed = method === 8 ? deflateRawSync(data) : data;
        const name = Buffer.from(entry.name, 'utf-8');
        const flags = (entry.encrypted === true ? 1 : 0) | 0x0800;
        const crc = crc32(data);
        const size = entry.declaredSize ?? data.length;
        const localExtra = zip64 ? Buffer.alloc(20) : Buffer.alloc(0);
        if (zip64) {
            localExtra.writeUInt16LE(0x0001, 0);
            localExtra.writeUInt16LE(16, 2);
            localExtra.writeBigUInt64LE(BigInt(size), 4);
            localExtra.writeBigUInt64LE(BigInt(compressed.length), 12);
        }
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(zip64 ? 45 : 20, 4);
        local.writeUInt16LE(flags, 6);
        local.writeUInt16LE(method, 8);
        local.writeUInt16LE(0, 10);
        local.writeUInt16LE(0x21, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(zip64 ? 0xffffffff : compressed.length, 18);
        local.writeUInt32LE(zip64 ? 0xffffffff : size, 22);
        local.writeUInt16LE(name.length, 26);
        local.writeUInt16LE(localExtra.length, 28);
        const centralExtra = zip64 ? Buffer.alloc(28) : Buffer.alloc(0);
        if (zip64) {
            centralExtra.writeUInt16LE(0x0001, 0);
            centralExtra.writeUInt16LE(24, 2);
            centralExtra.writeBigUInt64LE(BigInt(size), 4);
            centralExtra.writeBigUInt64LE(BigInt(compressed.length), 12);
            centralExtra.writeBigUInt64LE(BigInt(offset), 20);
        }
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE((3 << 8) | 20, 4);
        central.writeUInt16LE(zip64 ? 45 : 20, 6);
        central.writeUInt16LE(flags, 8);
        central.writeUInt16LE(method, 10);
        central.writeUInt16LE(0, 12);
        central.writeUInt16LE(0x21, 14);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(zip64 ? 0xffffffff : compressed.length, 20);
        central.writeUInt32LE(zip64 ? 0xffffffff : size, 24);
        central.writeUInt16LE(name.length, 28);
        central.writeUInt16LE(centralExtra.length, 30);
        central.writeUInt32LE(((entry.mode ?? (entry.name.endsWith('/') ? 0o040755 : 0o100644)) << 16) >>> 0, 38);
        central.writeUInt32LE(zip64 ? 0xffffffff : offset, 42);
        const localRecord = Buffer.concat([local, name, localExtra, compressed]);
        locals.push(localRecord);
        centrals.push(Buffer.concat([central, name, centralExtra]));
        offset += localRecord.length;
    }
    const directory = Buffer.concat(centrals);
    const tail: Buffer[] = [];
    if (zip64) {
        const record = Buffer.alloc(56);
        record.writeUInt32LE(0x06064b50, 0);
        record.writeBigUInt64LE(44n, 4);
        record.writeUInt16LE(45, 12);
        record.writeUInt16LE(45, 14);
        record.writeBigUInt64LE(BigInt(entries.length), 24);
        record.writeBigUInt64LE(BigInt(entries.length), 32);
        record.writeBigUInt64LE(BigInt(directory.length), 40);
        record.writeBigUInt64LE(BigInt(offset), 48);
        const locator = Buffer.alloc(20);
        locator.writeUInt32LE(0x07064b50, 0);
        locator.writeBigUInt64LE(BigInt(offset + directory.length), 8);
        locator.writeUInt32LE(1, 16);
        tail.push(record, locator);
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(zip64 ? 0xffff : entries.length, 8);
    end.writeUInt16LE(zip64 ? 0xffff : entries.length, 10);
    end.writeUInt32LE(zip64 ? 0xffffffff : directory.length, 12);
    end.writeUInt32LE(zip64 ? 0xffffffff : offset, 16);
    return Buffer.concat([...locals, directory, ...tail, end]);
}

interface TarFixtureEntry {
    name: string;
    /* `0` a file, `2` a link, `5` a folder, `1` a hard link, `L` a GNU long name, `x` a pax header. */
    type?: string;
    data?: string | Uint8Array;
    linkName?: string;
    mtime?: number;
    mode?: number;
    /* Puts the leading folders in the ustar prefix field. */
    prefix?: string;
    badChecksum?: boolean;
}

function field(block: Buffer, offset: number, length: number, text: string): void {
    block.write(text, offset, Math.min(length, Buffer.byteLength(text)), 'utf-8');
}

function octal(value: number, length: number): string {
    return `${value.toString(8).padStart(length - 1, '0')}\0`;
}

export function tarHeader(entry: TarFixtureEntry): Buffer {
    const data = bytesOf(entry.data);
    const block = Buffer.alloc(512);
    field(block, 0, 100, entry.name);
    field(block, 100, 8, octal(entry.mode ?? 0o644, 8));
    field(block, 108, 8, octal(0, 8));
    field(block, 116, 8, octal(0, 8));
    field(block, 124, 12, octal(data.length, 12));
    field(block, 136, 12, octal(entry.mtime ?? 1_700_000_000, 12));
    block.write(entry.type ?? '0', 156, 1, 'latin1');
    field(block, 157, 100, entry.linkName ?? '');
    block.write('ustar\u000000', 257, 8, 'latin1');
    field(block, 345, 155, entry.prefix ?? '');
    block.fill(0x20, 148, 156);
    let sum = 0;
    for (const byte of block) {
        sum += byte;
    }
    field(block, 148, 8, `${(entry.badChecksum === true ? sum + 1 : sum).toString(8).padStart(6, '0')}\0 `);
    return block;
}

/* A tar of these entries, each padded to its block, and the two zero blocks that end one. */
export function buildTar(entries: readonly TarFixtureEntry[]): Buffer {
    const parts: Buffer[] = [];
    for (const entry of entries) {
        const data = bytesOf(entry.data);
        parts.push(tarHeader(entry), Buffer.from(data), Buffer.alloc((512 - (data.length % 512)) % 512));
    }
    parts.push(Buffer.alloc(1024));
    return Buffer.concat(parts);
}

/* One pax record, whose length counts itself. */
export function paxRecord(key: string, value: string): string {
    const body = ` ${key}=${value}\n`;
    let length = Buffer.byteLength(body) + 1;
    while (`${length}`.length + Buffer.byteLength(body) !== length) {
        length = `${length}`.length + Buffer.byteLength(body);
    }
    return `${length}${body}`;
}
