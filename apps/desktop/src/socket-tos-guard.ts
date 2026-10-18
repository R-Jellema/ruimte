import { Socket } from 'node:net';

type SetTypeOfService = (this: Socket, tos: number) => Socket;

/*
 * Node 24's bundled undici sets the type-of-service byte on the first write of every socket, unguarded;
 * on macOS that throws EINVAL once the peer reset the connection, as an uncaught exception no fetch can
 * catch. Fixed in undici 8.8.0 (nodejs/undici#5547, Node 26.5.1); remove once Electron ships that Node.
 */
export function installSocketTypeOfServiceGuard(prototype: { setTypeOfService?: SetTypeOfService } = Socket.prototype as never): void {
    const original = prototype.setTypeOfService;
    if (original === undefined) {
        return;
    }
    prototype.setTypeOfService = function (this: Socket, tos: number): Socket {
        try {
            return original.call(this, tos);
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code === 'EINVAL') {
                return this;
            }
            throw e;
        }
    };
}
