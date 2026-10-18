import { describe, expect, test } from 'bun:test';
import type { Socket } from 'node:net';
import { installSocketTypeOfServiceGuard } from './socket-tos-guard';

function failing(code: string) {
    return {
        setTypeOfService(this: Socket, _tos: number): Socket {
            throw Object.assign(new Error(`setTypeOfService ${code}`), { code });
        }
    };
}

describe('installSocketTypeOfServiceGuard', () => {
    test('a socket the peer already reset keeps going', () => {
        const prototype = failing('EINVAL');
        installSocketTypeOfServiceGuard(prototype);
        const socket = {} as Socket;
        expect(prototype.setTypeOfService.call(socket, 0)).toBe(socket);
    });

    test('every other error still throws', () => {
        const prototype = failing('EBADF');
        installSocketTypeOfServiceGuard(prototype);
        expect(() => prototype.setTypeOfService.call({} as Socket, 0)).toThrow('setTypeOfService EBADF');
    });

    test('a Node without the method is left alone', () => {
        const prototype = {};
        installSocketTypeOfServiceGuard(prototype);
        expect(prototype).toEqual({});
    });
});
