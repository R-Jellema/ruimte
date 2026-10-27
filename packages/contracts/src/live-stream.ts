export const LIVE_STREAM_CONTENT_TYPE = 'application/x-ruimte-jpeg-stream; version=1';
export const HEVC_STREAM_CONTENT_TYPE = 'application/x-ruimte-hevc-stream; version=1';
export const H264_STREAM_CONTENT_TYPE = 'application/x-ruimte-h264-stream; version=1';
export const LIVE_STREAM_MAGIC = new Uint8Array([0x52, 0x53, 0x54, 0x4d, 0x01, 0x00, 0x00, 0x00]);
export const LIVE_STREAM_FRAME_HEADER_BYTES = 12;
export const LIVE_STREAM_MAX_FRAME_BYTES = 8 * 1024 * 1024;

export interface LiveStreamFrame {
    sequence: number;
    width: number;
    height: number;
    data: Uint8Array;
    format?: LiveStreamFormat;
    /* Set by a video source only: what a stream that has to drop a frame waits for. Only `device.frame` carries it. */
    keyFrame?: boolean;
}

/* Where each NAL unit's header byte sits in an Annex-B access unit, after a three or four byte start code. */
export function annexBNalHeaders(data: Uint8Array): number[] {
    const headers: number[] = [];
    for (let index = 0; index + 3 < data.byteLength; index += 1) {
        if (data[index] === 0 && data[index + 1] === 0 && data[index + 2] === 1) {
            headers.push(index + 3);
            index += 3;
        }
    }
    return headers;
}

export function hevcKeyFrame(data: Uint8Array): boolean {
    return annexBNalHeaders(data).some((header) => {
        const type = (data[header]! >> 1) & 0x3f;
        return type >= 16 && type <= 23;
    });
}

export const H264_SPS = 7;
const H264_IDR = 5;

export function h264KeyFrame(data: Uint8Array): boolean {
    return annexBNalHeaders(data).some((header) => {
        const type = data[header]! & 0x1f;
        return type === H264_IDR || type === H264_SPS;
    });
}

export type LiveStreamFormat = 'jpeg' | 'hevc' | 'h264';

const CONTENT_TYPES: Record<LiveStreamFormat, string> = {
    jpeg: LIVE_STREAM_CONTENT_TYPE,
    hevc: HEVC_STREAM_CONTENT_TYPE,
    h264: H264_STREAM_CONTENT_TYPE
};

export function liveStreamContentType(format: LiveStreamFormat): string {
    return CONTENT_TYPES[format];
}

/* The format a live stream response carries, or null for one this version cannot read. */
export function liveStreamFormatOf(contentType: string): LiveStreamFormat | null {
    const mediaType = contentType.split(';')[0]!.trim();
    const match = (Object.entries(CONTENT_TYPES) as Array<[LiveStreamFormat, string]>).find(([, type]) => type.split(';')[0] === mediaType);
    return match ? match[0] : null;
}

export function encodeLiveStreamFrame(frame: LiveStreamFrame): Uint8Array {
    if (frame.data.byteLength > LIVE_STREAM_MAX_FRAME_BYTES) {
        throw new Error('Live stream frame is too large');
    }
    if (!Number.isInteger(frame.sequence) || frame.sequence < 0 || frame.sequence > 0xffffffff) {
        throw new Error('Live stream sequence is outside uint32');
    }
    if (
        !Number.isInteger(frame.width) ||
        !Number.isInteger(frame.height) ||
        frame.width < 1 ||
        frame.height < 1 ||
        frame.width > 0xffff ||
        frame.height > 0xffff
    ) {
        throw new Error('Live stream dimensions are outside uint16');
    }
    const encoded = new Uint8Array(LIVE_STREAM_FRAME_HEADER_BYTES + frame.data.byteLength);
    const header = new DataView(encoded.buffer);
    header.setUint32(0, frame.data.byteLength);
    header.setUint32(4, frame.sequence);
    header.setUint16(8, frame.width);
    header.setUint16(10, frame.height);
    encoded.set(frame.data, LIVE_STREAM_FRAME_HEADER_BYTES);
    return encoded;
}

/* The header at the start of `bytes`, which must hold at least `LIVE_STREAM_FRAME_HEADER_BYTES`. */
export function readLiveStreamFrameHeader(bytes: Uint8Array): { length: number; sequence: number; width: number; height: number } {
    const header = new DataView(bytes.buffer, bytes.byteOffset, LIVE_STREAM_FRAME_HEADER_BYTES);
    return { length: header.getUint32(0), sequence: header.getUint32(4), width: header.getUint16(8), height: header.getUint16(10) };
}

export class LiveStreamDecoder {
    private buffer: Uint8Array = new Uint8Array();
    private preambleRead = false;

    /* Nothing here writes into a buffer it holds, so the rest of one is kept as a view rather than a copy. */
    push(chunk: Uint8Array): LiveStreamFrame[] {
        if (this.buffer.byteLength === 0) {
            this.buffer = chunk;
        } else {
            const joined = new Uint8Array(this.buffer.byteLength + chunk.byteLength);
            joined.set(this.buffer);
            joined.set(chunk, this.buffer.byteLength);
            this.buffer = joined;
        }

        if (!this.preambleRead) {
            if (this.buffer.byteLength < LIVE_STREAM_MAGIC.byteLength) {
                return [];
            }
            for (let index = 0; index < LIVE_STREAM_MAGIC.byteLength; index += 1) {
                if (this.buffer[index] !== LIVE_STREAM_MAGIC[index]) {
                    throw new Error('Unknown live stream format');
                }
            }
            this.buffer = this.buffer.subarray(LIVE_STREAM_MAGIC.byteLength);
            this.preambleRead = true;
        }

        const frames: LiveStreamFrame[] = [];
        while (this.buffer.byteLength >= LIVE_STREAM_FRAME_HEADER_BYTES) {
            const { length, sequence, width, height } = readLiveStreamFrameHeader(this.buffer);
            if (length > LIVE_STREAM_MAX_FRAME_BYTES) {
                throw new Error('Live stream frame is too large');
            }
            const total = LIVE_STREAM_FRAME_HEADER_BYTES + length;
            if (this.buffer.byteLength < total) {
                break;
            }
            frames.push({ sequence, width, height, data: this.buffer.slice(LIVE_STREAM_FRAME_HEADER_BYTES, total) });
            this.buffer = this.buffer.subarray(total);
        }
        return frames;
    }
}
