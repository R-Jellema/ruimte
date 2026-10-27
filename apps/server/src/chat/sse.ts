/*
 * Reads a server-sent event stream and hands `onData` the data of each event, its `data:` lines joined.
 * It stops at the end of the stream, or after the chunk in which `onData` answered true; past `maxBytes` it throws `tooLarge`.
 */
export async function readEventData(
    body: AsyncIterable<Uint8Array>,
    maxBytes: number,
    tooLarge: string,
    onData: (data: string) => boolean | void
): Promise<void> {
    const decoder = new TextDecoder();
    let buffer = '';
    let bytes = 0;
    let done = false;
    for await (const chunk of body) {
        bytes += chunk.byteLength;
        if (bytes > maxBytes) {
            throw new Error(tooLarge);
        }
        // A line ending can fall across two chunks, so the whole buffer is normalized each time.
        buffer = (buffer + decoder.decode(chunk, { stream: true })).replace(/\r\n/g, '\n');
        let boundary: number;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
            const data = buffer
                .slice(0, boundary)
                .split('\n')
                .filter((line) => line.startsWith('data:'))
                .map((line) => line.slice(5).trimStart())
                .join('\n');
            buffer = buffer.slice(boundary + 2);
            if (data !== '' && onData(data) === true) {
                done = true;
            }
        }
        if (done) {
            return;
        }
    }
}
