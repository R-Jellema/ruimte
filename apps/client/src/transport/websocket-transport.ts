import { PROTOCOL_REFUSED_CLOSE_CODE, protocolMismatch, protocolOfRefusal } from '@ruimte/contracts';
import { LinkTransport, type Link, type LinkEvents, type SocketAddress } from './link-transport';
import { protocolRefusal, withProtocol } from './protocol';

export type { SocketAddress } from './link-transport';

/* The wire as it always travelled: one WebSocket per connection, the credential in its URL. */
export function socketLink(url: string, events: LinkEvents): Link {
    const socket = new WebSocket(withProtocol(url));
    socket.binaryType = 'arraybuffer';
    socket.onopen = () => events.open();
    socket.onmessage = (message: MessageEvent<string | ArrayBuffer>) =>
        events.message(typeof message.data === 'string' ? message.data : new Uint8Array(message.data));
    socket.onclose = (event) => {
        const daemon = event.code === PROTOCOL_REFUSED_CLOSE_CODE ? protocolOfRefusal(event.reason) : null;
        const mismatch = daemon === null ? null : protocolMismatch(daemon);
        events.close(mismatch === null ? null : protocolRefusal(mismatch));
    };
    // The browser fires close right after error, so close owns the state change.
    socket.onerror = () => {};
    return {
        send: (data) => socket.send(data),
        close: () => socket.close()
    };
}

export class WebSocketTransport extends LinkTransport {
    constructor(address: SocketAddress) {
        super(address, socketLink);
    }
}
