import { ArchiveError } from './limits.ts';
import type { ChunkReader } from './streams.ts';

/*
 * A tar read header by header off a stream, so listing one never holds more than a block and the
 * entry being read. POSIX ustar with its prefix, GNU long names (`L`, `K`) and pax extended headers
 * (`x`) are read; a global pax header (`g`) is passed over. Format: POSIX.1-2017, pax and ustar.
 */

const BLOCK = 512;

// A pax header or a GNU long name is a few hundred bytes; past this it is not a header anyone wrote.
const META_MAX_BYTES = 1024 * 1024;

export type TarKind = 'file' | 'directory' | 'symlink' | 'hardlink' | 'other';

export interface TarHeader {
    /* As the archive spells it, before anything decides whether it is safe. */
    name: string;
    kind: TarKind;
    size: number;
    mtime: number | null;
    mode: number;
    /* False for a GNU sparse file, whose bytes on the stream are not the file. */
    readable: boolean;
}

function text(bytes: Uint8Array): string {
    const end = bytes.indexOf(0);
    return new TextDecoder('utf-8').decode(end < 0 ? bytes : bytes.subarray(0, end));
}

/* An octal field, or a base-256 one when its high bit is set, which is how GNU writes what octal cannot hold. */
function numeric(bytes: Uint8Array): number {
    if ((bytes[0]! & 0x80) !== 0) {
        let value = bytes[0]! & 0x7f;
        for (const byte of bytes.subarray(1)) {
            value = value * 256 + byte;
        }
        if (!Number.isSafeInteger(value)) {
            throw new ArchiveError('corrupt', 'A tar header names a number no file has');
        }
        return value;
    }
    const digits = new TextDecoder('latin1')
        .decode(bytes)
        .replace(/[\0 ]+$/, '')
        .trim();
    if (digits === '') {
        return 0;
    }
    if (!/^[0-7]+$/.test(digits)) {
        throw new ArchiveError('corrupt', 'A tar header holds a number that is not octal');
    }
    return Number.parseInt(digits, 8);
}

/* Whether the block is a header whose checksum holds: the sum of its bytes with the checksum field counted as spaces. */
export function isTarHeader(block: Uint8Array): boolean {
    if (block.length < BLOCK) {
        return false;
    }
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) {
        sum += i >= 148 && i < 156 ? 0x20 : block[i]!;
    }
    try {
        return numeric(block.subarray(148, 156)) === sum;
    } catch {
        return false;
    }
}

function isZeroBlock(block: Uint8Array): boolean {
    return block.every((byte) => byte === 0);
}

function padding(size: number): number {
    return (BLOCK - (size % BLOCK)) % BLOCK;
}

/* The records of a pax header: `<length> <key>=<value>\n`, the length counting the whole record in bytes. */
function paxRecords(bytes: Uint8Array): Map<string, string> {
    const records = new Map<string, string>();
    let at = 0;
    while (at < bytes.length) {
        const space = bytes.indexOf(0x20, at);
        if (space < 0) {
            break;
        }
        const length = Number.parseInt(new TextDecoder('latin1').decode(bytes.subarray(at, space)), 10);
        if (!Number.isInteger(length) || length <= space - at || at + length > bytes.length) {
            throw new ArchiveError('corrupt', 'A pax header of this tar does not hold together');
        }
        const record = new TextDecoder('utf-8').decode(bytes.subarray(space + 1, at + length - 1));
        const equals = record.indexOf('=');
        if (equals > 0) {
            records.set(record.slice(0, equals), record.slice(equals + 1));
        }
        at += length;
    }
    return records;
}

function kindOf(type: string, name: string): TarKind {
    if (type === '5' || ((type === '0' || type === '\0') && name.endsWith('/'))) {
        return 'directory';
    }
    if (type === '2') {
        return 'symlink';
    }
    if (type === '1') {
        return 'hardlink';
    }
    // Devices and FIFOs; POSIX has every type it does not name read as a plain file.
    return type === '3' || type === '4' || type === '6' ? 'other' : 'file';
}

interface TarEntry {
    header: TarHeader;
    /* The entry's bytes; whatever is not taken before the next entry is asked for is skipped. */
    body(): AsyncGenerator<Uint8Array>;
}

/*
 * The entries of a tar, one at a time. The stream ends at the first zero block, which is where a tar
 * ends; a header whose checksum fails is a corrupt archive, not the end of one.
 */
export async function* tarEntries(reader: ChunkReader): AsyncGenerator<TarEntry> {
    let longName: string | null = null;
    let pax = new Map<string, string>();
    for (;;) {
        const block = await reader.read(BLOCK);
        if (block === null || isZeroBlock(block)) {
            return;
        }
        if (!isTarHeader(block)) {
            throw new ArchiveError('corrupt', 'A header of this tar does not match its checksum');
        }
        const type = String.fromCharCode(block[156]!);
        let size = numeric(block.subarray(124, 136));
        if (type === 'L' || type === 'K' || type === 'x' || type === 'g') {
            if (size > META_MAX_BYTES) {
                throw new ArchiveError('corrupt', 'A long name or pax header of this tar is larger than any header');
            }
            const data = (await reader.read(size)) ?? new Uint8Array(0);
            await reader.skip(padding(size));
            if (type === 'L') {
                longName = text(data);
            } else if (type === 'x') {
                pax = paxRecords(data);
            }
            continue;
        }
        // POSIX keeps a prefix in the bytes GNU spends on access and change times.
        const posix = new TextDecoder('latin1').decode(block.subarray(257, 263)) === 'ustar\0';
        const prefix = posix ? text(block.subarray(345, 500)) : '';
        const shortName = text(block.subarray(0, 100));
        const name = pax.get('path') ?? longName ?? (prefix === '' ? shortName : `${prefix}/${shortName}`);
        const paxSize = pax.get('size');
        if (paxSize !== undefined) {
            size = Number.parseInt(paxSize, 10);
            if (!Number.isSafeInteger(size) || size < 0) {
                throw new ArchiveError('corrupt', 'A pax header of this tar names a size no file has');
            }
        }
        const paxTime = pax.get('mtime');
        const seconds = paxTime === undefined ? numeric(block.subarray(136, 148)) : Number.parseFloat(paxTime);
        const kind = kindOf(type, name);
        // Only a file carries bytes; the size of a link, a folder or a device is a number and no data.
        const carried = kind === 'file' ? size : 0;
        longName = null;
        pax = new Map();
        let left = carried;
        yield {
            header: {
                name,
                kind,
                size: kind === 'file' ? size : 0,
                mtime: Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null,
                mode: numeric(block.subarray(100, 108)),
                readable: type !== 'S'
            },
            body: async function* () {
                for await (const piece of reader.take(left)) {
                    left -= piece.length;
                    yield piece;
                }
            }
        };
        await reader.skip(left + padding(carried));
    }
}
