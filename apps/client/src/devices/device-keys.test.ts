import { describe, expect, test } from 'bun:test';
import { routeDeviceKey, type KeyPress } from './device-keys';

function press(code: string, modifiers: Partial<KeyPress> = {}): KeyPress {
    return { code, metaKey: false, ctrlKey: false, repeat: false, isComposing: false, ...modifiers };
}

describe('routeDeviceKey', () => {
    test('sends a key of the keyboard to the device', () => {
        expect(routeDeviceKey(press('KeyA'), true)).toEqual({ kind: 'key', usage: 0x04 });
        expect(routeDeviceKey(press('ShiftLeft'), true)).toEqual({ kind: 'key', usage: 0xe1 });
        expect(routeDeviceKey(press('KeyA', { ctrlKey: true }), true)).toEqual({ kind: 'key', usage: 0x04 });
    });

    test("leaves a command chord to Ruimte's shortcuts and pastes on the paste chord", () => {
        expect(routeDeviceKey(press('KeyK', { metaKey: true }), true)).toEqual({ kind: 'pass' });
        expect(routeDeviceKey(press('MetaLeft', { metaKey: true }), true)).toEqual({ kind: 'pass' });
        expect(routeDeviceKey(press('KeyV', { metaKey: true }), true)).toEqual({ kind: 'paste' });
        expect(routeDeviceKey(press('KeyV', { ctrlKey: true }), false)).toEqual({ kind: 'paste' });
        expect(routeDeviceKey(press('KeyK', { ctrlKey: true }), false)).toEqual({ kind: 'pass' });
    });

    test('keeps a repeat and a key that composes from the device', () => {
        expect(routeDeviceKey(press('KeyA', { repeat: true }), true)).toEqual({ kind: 'swallow' });
        expect(routeDeviceKey(press('KeyE', { isComposing: true }), true)).toEqual({ kind: 'swallow' });
        expect(routeDeviceKey(press('KeyV', { metaKey: true, repeat: true }), true)).toEqual({ kind: 'pass' });
    });

    test('passes a key the device keyboard does not have', () => {
        expect(routeDeviceKey(press('MediaPlayPause'), true)).toEqual({ kind: 'pass' });
    });
});
