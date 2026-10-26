import { createInflateRaw, crc32 } from 'node:zlib';
import { ARCHIVE_SCAN_MAX_ENTRIES, ArchiveError, type InflateMeter } from './limits.ts';
import { inflated, rangeChunks, type RandomAccess } from './streams.ts';

/*
 * A zip read from its central directory, the way the format means it to be read: the end record says
 * where the directory is, the directory says where every entry is, and nothing else of the file is read
 * until an entry is. ZIP64 records stand in for every field that ran out of room.
 * Format: PKWARE's APPNOTE.TXT, sections 4.3 and 4.5.
 */

const END_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_END_SIGNATURE = 0x06064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

const END_SIZE = 22;
const ZIP64_LOCATOR_SIZE = 20;
const CENTRAL_SIZE = 46;
const LOCAL_SIZE = 30;
const MAX_COMMENT = 0xffff;

const ZIP64_EXTRA = 0x0001;
const TIMESTAMP_EXTRA = 0x5455;
const UNICODE_PATH_EXTRA = 0x7075;

const FLAG_ENCRYPTED = 0x0001;
const FLAG_UTF8 = 0x0800;

export const STORED = 0;
const DEFLATED = 8;

// The hosts in "version made by" whose external attributes carry a Unix mode: Unix and OS X.
const UNIX_HOSTS = new Set([3, 19]);

// How much of the central directory one read takes in; an entry larger than this is read on its own.
const WINDOW_BYTES = 1024 * 1024;

export interface ZipEntry {
    /* As the archive spells it, before anything decides whether it is safe. */
    name: string;
    directory: boolean;
    symlink: boolean;
    method: number;
    encrypted: boolean;
    compressedSize: number;
    size: number;
    crc: number;
    localOffset: number;
    mtime: number | null;
    /* The Unix permission bits, when the archive was made where those exist. */
    mode: number | null;
}

/* Whether this machine can hand out the entry's bytes: not encrypted, and stored or deflated. */
export function zipReadable(entry: ZipEntry): boolean {
    return !entry.encrypted && (entry.method === STORED || entry.method === DEFLATED);
}

function view(bytes: Uint8Array): DataView {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function uint64(data: DataView, offset: number): number {
    const value = data.getBigUint64(offset, true);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new ArchiveError('corrupt', 'The archive names an offset or size no file has');
    }
    return Number(value);
}

function decodeName(bytes: Uint8Array, utf8: boolean): string {
    if (utf8) {
        return new TextDecoder('utf-8').decode(bytes);
    }
    // Without the flag the name is meant as code page 437, though most tools write UTF-8 anyway; Latin-1 keeps the rest legible.
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
        return new TextDecoder('latin1').decode(bytes);
    }
}

function dosTime(time: number, date: number): number | null {
    if (date === 0) {
        return null;
    }
    const year = 1980 + (date >> 9);
    const month = ((date >> 5) & 0x0f) - 1;
    const day = date & 0x1f;
    const at = new Date(year, month, day, time >> 11, (time >> 5) & 0x3f, (time & 0x1f) * 2).getTime();
    return Number.isNaN(at) ? null : at;
}

/* A window over the file that serves the many small reads the directory takes from one large one. */
class Window {
    private start = 0;
    private bytes: Uint8Array = new Uint8Array(0);
    private readonly file: RandomAccess;

    constructor(file: RandomAccess) {
        this.file = file;
    }

    async at(offset: number, length: number): Promise<Uint8Array> {
        if (offset < this.start || offset + length > this.start + this.bytes.length) {
            this.bytes = await this.file.read(offset, Math.max(length, WINDOW_BYTES));
            this.start = offset;
        }
        const from = offset - this.start;
        if (from + length > this.bytes.length) {
            throw new ArchiveError('corrupt', 'The central directory of this zip runs past the end of the file');
        }
        return this.bytes.subarray(from, from + length);
    }
}

interface Directory {
    offset: number;
    size: number;
    count: number;
}

/* Where the central directory is, from the end record and its ZIP64 counterpart when the file has one. */
async function locateDirectory(file: RandomAccess): Promise<Directory> {
    const tailLength = Math.min(file.size, END_SIZE + MAX_COMMENT);
    const tailStart = file.size - tailLength;
    const tail = await file.read(tailStart, tailLength);
    const data = view(tail);
    let end = -1;
    for (let at = tail.length - END_SIZE; at >= 0; at--) {
        // The comment length has to reach to the end of the file, or these four bytes are part of something else.
        if (data.getUint32(at, true) === END_SIGNATURE && at + END_SIZE + data.getUint16(at + 20, true) <= tail.length) {
            end = at;
            break;
        }
    }
    if (end < 0) {
        throw new ArchiveError('corrupt', 'This zip has no end record, so it is cut off or not a zip at all');
    }
    let directory: Directory = { count: data.getUint16(end + 10, true), size: data.getUint32(end + 12, true), offset: data.getUint32(end + 16, true) };
    const locatorAt = end - ZIP64_LOCATOR_SIZE;
    if (locatorAt >= 0 && data.getUint32(locatorAt, true) === ZIP64_LOCATOR_SIGNATURE) {
        const recordOffset = uint64(data, locatorAt + 8);
        const record = view(await file.read(recordOffset, 56));
        if (record.byteLength < 56 || record.getUint32(0, true) !== ZIP64_END_SIGNATURE) {
            throw new ArchiveError('corrupt', 'The ZIP64 end record of this zip is not where its locator says');
        }
        directory = { count: uint64(record, 32), size: uint64(record, 40), offset: uint64(record, 48) };
    }
    if (directory.offset + directory.size > file.size) {
        throw new ArchiveError('corrupt', 'The central directory of this zip lies past the end of the file');
    }
    return directory;
}

interface Extra {
    zip64?: DataView;
    mtime?: number;
    unicodeName?: string;
}

function readExtra(bytes: Uint8Array): Extra {
    const extra: Extra = {};
    const data = view(bytes);
    let at = 0;
    while (at + 4 <= bytes.length) {
        const id = data.getUint16(at, true);
        const size = data.getUint16(at + 2, true);
        const body = bytes.subarray(at + 4, Math.min(at + 4 + size, bytes.length));
        if (id === ZIP64_EXTRA) {
            extra.zip64 = view(body);
        } else if (id === TIMESTAMP_EXTRA && body.length >= 5 && (body[0]! & 1) === 1) {
            extra.mtime = view(body).getInt32(1, true) * 1000;
        } else if (id === UNICODE_PATH_EXTRA && body.length > 5 && body[0] === 1) {
            extra.unicodeName = new TextDecoder('utf-8').decode(body.subarray(5));
        }
        at += 4 + size;
    }
    return extra;
}

/* The fields the ZIP64 extra holds instead, in the order the format fixes: only those that ran out of room are there. */
function widened(extra: DataView | undefined, fields: { size: number; compressedSize: number; localOffset: number }): typeof fields {
    const result = { ...fields };
    let at = 0;
    const next = (): number => {
        if (extra === undefined || at + 8 > extra.byteLength) {
            throw new ArchiveError('corrupt', 'An entry of this zip needs a ZIP64 field it does not carry');
        }
        const value = uint64(extra, at);
        at += 8;
        return value;
    };
    if (fields.size === 0xffffffff) {
        result.size = next();
    }
    if (fields.compressedSize === 0xffffffff) {
        result.compressedSize = next();
    }
    if (fields.localOffset === 0xffffffff) {
        result.localOffset = next();
    }
    return result;
}

/*
 * The entries in the order of the central directory, up to `max`. The directory's own count is only a
 * hint: an entry is read while its signature is there and it fits inside the directory.
 */
export async function readZipDirectory(file: RandomAccess, max: number = ARCHIVE_SCAN_MAX_ENTRIES): Promise<{ entries: ZipEntry[]; truncated: boolean }> {
    const directory = await locateDirectory(file);
    const window = new Window(file);
    const entries: ZipEntry[] = [];
    const end = directory.offset + directory.size;
    let at = directory.offset;
    while (at + CENTRAL_SIZE <= end && entries.length < directory.count) {
        if (entries.length >= max) {
            return { entries, truncated: true };
        }
        const head = view(await window.at(at, CENTRAL_SIZE));
        if (head.getUint32(0, true) !== CENTRAL_SIGNATURE) {
            throw new ArchiveError('corrupt', 'The central directory of this zip breaks off');
        }
        const flags = head.getUint16(8, true);
        const nameLength = head.getUint16(28, true);
        const extraLength = head.getUint16(30, true);
        const commentLength = head.getUint16(32, true);
        const variable = await window.at(at + CENTRAL_SIZE, nameLength + extraLength);
        const extra = readExtra(variable.subarray(nameLength));
        const host = head.getUint16(4, true) >> 8;
        const external = head.getUint32(38, true);
        const mode = UNIX_HOSTS.has(host) ? external >>> 16 : null;
        const name = extra.unicodeName ?? decodeName(variable.subarray(0, nameLength), (flags & FLAG_UTF8) !== 0);
        const sizes = widened(extra.zip64, {
            compressedSize: head.getUint32(20, true),
            size: head.getUint32(24, true),
            localOffset: head.getUint32(42, true)
        });
        const type = mode === null ? 0 : mode & 0o170000;
        entries.push({
            name,
            directory: name.endsWith('/') || name.endsWith('\\') || type === 0o040000 || (host === 0 && (external & 0x10) !== 0),
            symlink: type === 0o120000,
            method: head.getUint16(10, true),
            encrypted: (flags & FLAG_ENCRYPTED) !== 0,
            crc: head.getUint32(16, true),
            mtime: extra.mtime ?? dosTime(head.getUint16(12, true), head.getUint16(14, true)),
            mode,
            ...sizes
        });
        at += CENTRAL_SIZE + nameLength + extraLength + commentLength;
    }
    return { entries, truncated: false };
}

/* Where the entry's data starts: past its local header, whose name and extra may differ in length from the directory's. */
async function dataOffset(file: RandomAccess, entry: ZipEntry): Promise<number> {
    const local = await file.read(entry.localOffset, LOCAL_SIZE);
    const data = view(local);
    if (local.length < LOCAL_SIZE || data.getUint32(0, true) !== LOCAL_SIGNATURE) {
        throw new ArchiveError('corrupt', `The data of ${entry.name} is not where the central directory says`);
    }
    const start = entry.localOffset + LOCAL_SIZE + data.getUint16(26, true) + data.getUint16(28, true);
    if (start + entry.compressedSize > file.size) {
        throw new ArchiveError('corrupt', `The data of ${entry.name} runs past the end of the file`);
    }
    return start;
}

async function* counted(source: AsyncIterable<Uint8Array>, meter: InflateMeter): AsyncGenerator<Uint8Array> {
    for await (const chunk of source) {
        meter.give(chunk.length);
        yield chunk;
    }
}

/*
 * One entry's bytes as they inflate. Only its compressed range of the file is read, and the output is
 * held to the size and checksum the directory gives: an entry that unpacks to more than it says is
 * refused at the first byte too many, whatever the meter still allows.
 */
export async function* zipEntryChunks(file: RandomAccess, entry: ZipEntry, meter: InflateMeter): AsyncGenerator<Uint8Array> {
    if (!zipReadable(entry)) {
        throw new ArchiveError(
            'not-readable',
            entry.encrypted ? `${entry.name} is encrypted` : `${entry.name} is compressed in a way this machine does not unpack`
        );
    }
    const raw = rangeChunks(file, await dataOffset(file, entry), entry.compressedSize, meter);
    const source = entry.method === STORED ? counted(raw, meter) : inflated(raw, createInflateRaw(), meter);
    let produced = 0;
    let crc = 0;
    for await (const chunk of source) {
        produced += chunk.length;
        if (produced > entry.size) {
            throw new ArchiveError('corrupt', `${entry.name} holds more than its header says`);
        }
        crc = crc32(chunk, crc);
        yield chunk;
    }
    if (produced !== entry.size || crc !== entry.crc) {
        throw new ArchiveError('corrupt', `${entry.name} does not match its checksum`);
    }
}
