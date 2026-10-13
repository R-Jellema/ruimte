import { z } from 'zod';
import { BrowserFrameSchema } from './browser.ts';
import { decodeHeadedFrame, encodeHeadedFrame } from './bytes.ts';
import { DeviceFrameSchema } from './device.ts';
import { LIVE_STREAM_MAX_FRAME_BYTES } from './live-stream.ts';

/*
 * A `device.frame` or `browser.frame` as one binary message, for a client that asked for those with
 * `binary` when it opened the stream: a headed frame of this kind whose head is `{ event, payload }`,
 * the payload without `data`, then the picture's bytes as they are. A daemon from before these
 * ignores the ask and sends the event as JSON with base64, which the client keeps reading.
 */
export const LIVE_FRAME_KIND = 2;

// The largest live frame a client reads: the largest picture a stream carries and room for its head.
export const LIVE_FRAME_MAX_BYTES = LIVE_STREAM_MAX_FRAME_BYTES + 16 * 1024;

const LiveFrameHeadSchema = z.discriminatedUnion('event', [
    z.object({ event: z.literal('device.frame'), payload: DeviceFrameSchema.omit({ data: true }) }),
    z.object({ event: z.literal('browser.frame'), payload: BrowserFrameSchema.omit({ data: true }) })
]);

export type LiveFrame = z.infer<typeof LiveFrameHeadSchema> & { bytes: Uint8Array };
export type LiveFrameEvent = LiveFrame['event'];
export type LiveFrameHeader<E extends LiveFrameEvent> = Extract<LiveFrame, { event: E }>['payload'];

export function encodeLiveFrame(frame: LiveFrame): Uint8Array<ArrayBuffer> {
    return encodeHeadedFrame(LIVE_FRAME_KIND, { event: frame.event, payload: frame.payload }, frame.bytes);
}

/* A live frame read back, or null for a frame that is not one this version knows. */
export function decodeLiveFrame(frame: Uint8Array): LiveFrame | null {
    const decoded = decodeHeadedFrame(frame, LIVE_FRAME_KIND);
    if (decoded === null) {
        return null;
    }
    const head = LiveFrameHeadSchema.safeParse(decoded.head);
    return head.success ? { ...head.data, bytes: decoded.bytes } : null;
}
