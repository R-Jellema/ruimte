import { describe, expect, test } from 'bun:test';
import { BrowserOpenPayloadSchema } from './browser.ts';
import { encodeBytesReply } from './bytes.ts';
import { DeviceOpenPayloadSchema } from './device.ts';
import { decodeLiveFrame, encodeLiveFrame, LIVE_FRAME_KIND, type LiveFrame } from './live-frame.ts';

const deviceFrame: LiveFrame = {
    event: 'device.frame',
    payload: { deviceId: 'phone', backendId: 'ios-sim', platform: 'ios', sequence: 4, width: 390, height: 844, format: 'hevc', keyFrame: true },
    bytes: new Uint8Array([0, 0, 1, 64, 255])
};

describe('live frames', () => {
    test('a device frame comes back with its event, header and bytes', () => {
        expect(decodeLiveFrame(encodeLiveFrame(deviceFrame))).toEqual(deviceFrame);
    });

    test('a browser frame comes back too', () => {
        const frame: LiveFrame = {
            event: 'browser.frame',
            payload: { browserId: 'node-1', sequence: 9, width: 800, height: 600 },
            bytes: new Uint8Array([1, 2])
        };
        expect(decodeLiveFrame(encodeLiveFrame(frame))).toEqual(frame);
    });

    test('refuses a bytes reply, another event and a header that is not a frame', () => {
        expect(decodeLiveFrame(encodeBytesReply('1', { mime: 'image/png', size: 1, version: 'v', offset: 0 }, new Uint8Array([1])))).toBeNull();
        const encoded = encodeLiveFrame(deviceFrame);
        expect(encoded[0]).toBe(LIVE_FRAME_KIND);
        const head = new TextEncoder().encode(JSON.stringify({ event: 'session.output', payload: deviceFrame.payload }));
        const other = new Uint8Array(5 + head.byteLength);
        other[0] = LIVE_FRAME_KIND;
        new DataView(other.buffer).setUint32(1, head.byteLength);
        other.set(head, 5);
        expect(decodeLiveFrame(other)).toBeNull();
        expect(decodeLiveFrame(encoded.subarray(0, 8))).toBeNull();
    });

    test('an open from a client that knows nothing of live frames still parses', () => {
        expect(DeviceOpenPayloadSchema.parse({ deviceId: 'phone', backendId: 'ios-sim', platform: 'ios', stream: 'events' }).binary).toBeUndefined();
        expect(BrowserOpenPayloadSchema.parse({ browserId: 'node-1', url: 'about:blank', width: 800, height: 600 }).binary).toBeUndefined();
    });
});
