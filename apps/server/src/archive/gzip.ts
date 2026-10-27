import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import type { InflateMeter } from './limits.ts';
import { counted, inflated } from './streams.ts';

/* Format: RFC 1952, section 2.3. */

const FLAG_EXTRA = 0x04;
const FLAG_NAME = 0x08;

interface GzipHeader {
    /* The name of the file it was made from, when the header keeps one. */
    name: string | null;
    mtime: number | null;
}

/* What the member header at the start of the file says, or null when it is not one. */
export function parseGzipHeader(bytes: Uint8Array): GzipHeader | null {
    if (bytes.length < 10 || bytes[0] !== 0x1f || bytes[1] !== 0x8b || bytes[2] !== 8) {
        return null;
    }
    const flags = bytes[3]!;
    const seconds = new DataView(bytes.buffer, bytes.byteOffset + 4, 4).getUint32(0, true);
    let at = 10;
    if ((flags & FLAG_EXTRA) !== 0) {
        if (at + 2 > bytes.length) {
            return { name: null, mtime: null };
        }
        at += 2 + (bytes[at]! | (bytes[at + 1]! << 8));
    }
    let name: string | null = null;
    if ((flags & FLAG_NAME) !== 0) {
        const end = bytes.indexOf(0, at);
        if (end > at) {
            // The format names the field ISO 8859-1.
            name = new TextDecoder('latin1').decode(bytes.subarray(at, end));
        }
    }
    return { name, mtime: seconds === 0 ? null : seconds * 1000 };
}

/* The file's bytes from the start, counted into the meter as they are read. */
async function* fileBytes(path: string, meter: InflateMeter): AsyncGenerator<Uint8Array> {
    const stream = createReadStream(path, { highWaterMark: 256 * 1024 });
    try {
        for await (const chunk of stream as AsyncIterable<Buffer>) {
            meter.take(chunk.length);
            yield new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.length);
        }
    } finally {
        stream.destroy();
    }
}

/* The file as it unpacks, every member after the other, under the meter's ceiling and ratio. */
export function gunzipChunks(path: string, meter: InflateMeter): AsyncGenerator<Uint8Array> {
    return inflated(fileBytes(path, meter), createGunzip(), meter);
}

/* The file as it is, for a tar that is not compressed; the meter only counts. */
export function plainChunks(path: string, meter: InflateMeter): AsyncGenerator<Uint8Array> {
    return counted(fileBytes(path, meter), meter);
}
