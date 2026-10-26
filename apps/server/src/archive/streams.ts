import { open, type FileHandle } from 'node:fs/promises';
import { Readable, type Transform } from 'node:stream';
import { ArchiveError, type InflateMeter } from './limits.ts';

// A slice of the file per read: large enough to keep a disk busy, small enough to never matter in memory.
const READ_SLICE = 256 * 1024;

/* A file read at offsets. `read` answers fewer bytes only at the end of the file. */
export interface RandomAccess {
    size: number;
    read(offset: number, length: number): Promise<Uint8Array>;
}

/* The file open for reads at offsets, closed once `work` is done with it, however it ends. */
export async function withFile<T>(path: string, work: (file: RandomAccess) => Promise<T>): Promise<T> {
    const handle: FileHandle = await open(path, 'r');
    try {
        const size = (await handle.stat()).size;
        return await work({
            size,
            read: async (offset, length) => {
                const buffer = new Uint8Array(Math.max(0, Math.min(length, size - offset)));
                let filled = 0;
                while (filled < buffer.length) {
                    const { bytesRead } = await handle.read(buffer, filled, buffer.length - filled, offset + filled);
                    if (bytesRead === 0) {
                        break;
                    }
                    filled += bytesRead;
                }
                return filled === buffer.length ? buffer : buffer.subarray(0, filled);
            }
        });
    } finally {
        await handle.close();
    }
}

/* A range of the file in slices, counted into the meter as it goes. */
export async function* rangeChunks(file: RandomAccess, offset: number, length: number, meter?: InflateMeter): AsyncGenerator<Uint8Array> {
    let at = offset;
    const end = offset + length;
    while (at < end) {
        const chunk = await file.read(at, Math.min(READ_SLICE, end - at));
        if (chunk.length === 0) {
            throw new ArchiveError('corrupt', 'The archive ends in the middle of an entry');
        }
        meter?.take(chunk.length);
        at += chunk.length;
        yield chunk;
    }
}

/*
 * What a zlib stream makes of the input, counted into the meter as it comes out. Ending early tears both
 * sides down, so an entry nobody reads to the end costs nothing more. zlib's own failure is a corrupt archive.
 */
export async function* inflated(source: AsyncIterable<Uint8Array>, inflater: Transform, meter: InflateMeter): AsyncGenerator<Uint8Array> {
    const input = Readable.from(source, { objectMode: false });
    input.on('error', (e) => inflater.destroy(e));
    input.pipe(inflater);
    const output = (inflater as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]();
    try {
        for (;;) {
            let next: IteratorResult<Uint8Array>;
            try {
                next = await output.next();
            } catch (e) {
                if (e instanceof ArchiveError) {
                    throw e;
                }
                throw new ArchiveError('corrupt', `The compressed data does not unpack: ${e instanceof Error ? e.message : String(e)}`);
            }
            if (next.done === true) {
                return;
            }
            meter.give(next.value.length);
            yield next.value;
        }
    } finally {
        input.destroy();
        inflater.destroy();
    }
}

/*
 * Exact reads over a stream of chunks of any size, which is what reading tar headers off a stream needs.
 * Nothing is kept beyond the chunk being taken apart.
 */
export class ChunkReader {
    private readonly iterator: AsyncIterator<Uint8Array>;
    private pending: Uint8Array = new Uint8Array(0);
    private ended = false;

    constructor(source: AsyncIterable<Uint8Array>) {
        this.iterator = source[Symbol.asyncIterator]();
    }

    private async fill(): Promise<boolean> {
        while (this.pending.length === 0 && !this.ended) {
            const next = await this.iterator.next();
            if (next.done) {
                this.ended = true;
            } else {
                this.pending = next.value;
            }
        }
        return this.pending.length > 0;
    }

    /* Exactly `length` bytes, or null when the stream ended before the first of them. */
    async read(length: number): Promise<Uint8Array | null> {
        const out = new Uint8Array(length);
        let filled = 0;
        while (filled < length) {
            if (!(await this.fill())) {
                if (filled === 0) {
                    return null;
                }
                throw new ArchiveError('corrupt', 'The archive ends in the middle of a header');
            }
            const take = Math.min(length - filled, this.pending.length);
            out.set(this.pending.subarray(0, take), filled);
            this.pending = this.pending.subarray(take);
            filled += take;
        }
        return out;
    }

    /* The next `length` bytes in the pieces they came in. */
    async *take(length: number): AsyncGenerator<Uint8Array> {
        let left = length;
        while (left > 0) {
            if (!(await this.fill())) {
                throw new ArchiveError('corrupt', 'The archive ends in the middle of an entry');
            }
            const take = Math.min(left, this.pending.length);
            const piece = this.pending.subarray(0, take);
            this.pending = this.pending.subarray(take);
            left -= take;
            yield piece;
        }
    }

    async skip(length: number): Promise<void> {
        let left = length;
        while (left > 0) {
            if (!(await this.fill())) {
                throw new ArchiveError('corrupt', 'The archive ends in the middle of an entry');
            }
            const take = Math.min(left, this.pending.length);
            this.pending = this.pending.subarray(take);
            left -= take;
        }
    }

    /* Ends the stream underneath, for a reader that has what it came for. */
    async close(): Promise<void> {
        await this.iterator.return?.();
    }
}

/* Every chunk of an iterable as one array, refusing at `max` bytes. */
export async function collect(source: AsyncIterable<Uint8Array>, max: number, tooLarge: () => Error): Promise<Uint8Array> {
    const parts: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of source) {
        total += chunk.length;
        if (total > max) {
            throw tooLarge();
        }
        parts.push(chunk);
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const part of parts) {
        out.set(part, at);
        at += part.length;
    }
    return out;
}
