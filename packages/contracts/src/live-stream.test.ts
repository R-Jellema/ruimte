import { describe, expect, test } from 'bun:test';
import { LIVE_STREAM_MAGIC, LiveStreamDecoder, encodeLiveStreamFrame, h264KeyFrame, hevcKeyFrame } from './live-stream.ts';

describe('hevcKeyFrame', () => {
    test('recognizes IRAP units in three and four byte Annex-B framing', () => {
        expect(hevcKeyFrame(new Uint8Array([0, 0, 0, 1, 19 << 1, 1]))).toBe(true);
        expect(hevcKeyFrame(new Uint8Array([0, 0, 1, 21 << 1, 1, 2]))).toBe(true);
        expect(hevcKeyFrame(new Uint8Array([0, 0, 0, 1, 1 << 1, 1]))).toBe(false);
    });
});

describe('h264KeyFrame', () => {
    test('recognizes an access unit that opens with its parameter sets', () => {
        const keyFrame = new Uint8Array([0, 0, 0, 1, 0x67, 0x42, 0xc0, 0x2a, 0, 0, 0, 1, 0x68, 0xce, 0, 0, 1, 0x65, 0x88]);

        expect(h264KeyFrame(keyFrame)).toBe(true);
    });

    test('recognizes an IDR slice on its own and passes over a delta slice', () => {
        expect(h264KeyFrame(new Uint8Array([0, 0, 1, 0x65, 0x88, 0x84]))).toBe(true);
        expect(h264KeyFrame(new Uint8Array([0, 0, 0, 1, 0x41, 0x9a, 0x02]))).toBe(false);
        expect(h264KeyFrame(new Uint8Array([0, 0, 0, 1, 0x09, 0xf0, 0, 0, 0, 1, 0x41, 0x9a]))).toBe(false);
    });
});

describe('LiveStreamDecoder', () => {
    test('decodes frames split across arbitrary transport chunks', () => {
        const encoded = encodeLiveStreamFrame({ sequence: 17, width: 640, height: 360, data: new Uint8Array([1, 2, 3, 4]) });
        const bytes = new Uint8Array(LIVE_STREAM_MAGIC.byteLength + encoded.byteLength);
        bytes.set(LIVE_STREAM_MAGIC);
        bytes.set(encoded, LIVE_STREAM_MAGIC.byteLength);
        const decoder = new LiveStreamDecoder();

        expect(decoder.push(bytes.slice(0, 5))).toEqual([]);
        expect(decoder.push(bytes.slice(5, 13))).toEqual([]);
        expect(decoder.push(bytes.slice(13))).toEqual([{ sequence: 17, width: 640, height: 360, data: new Uint8Array([1, 2, 3, 4]) }]);
    });

    test('rejects an unknown stream preamble', () => {
        const decoder = new LiveStreamDecoder();
        expect(() => decoder.push(new Uint8Array(8))).toThrow('Unknown live stream format');
    });
});
