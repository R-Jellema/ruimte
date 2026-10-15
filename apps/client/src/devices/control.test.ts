import { describe, expect, test } from 'bun:test';
import type { DeviceInfo } from '@ruimte/contracts';
import { useToasts } from '@/state/toasts';
import { controlDevice, eraseDevice, restartDevice } from './control';

const phone: DeviceInfo = {
    deviceId: 'phone-1',
    backendId: 'simctl',
    platform: 'ios',
    kind: 'simulator',
    name: 'iPhone 18 Pro',
    runtime: 'iOS 27.0',
    state: 'booted',
    capabilities: { boot: true, shutdown: true, stream: true, input: true, screenshot: true }
};

const refusing = {
    boot: async (): Promise<DeviceInfo> => phone,
    shutdown: async (): Promise<DeviceInfo> => {
        throw new Error('Unable to shutdown device in current state: Shutting Down');
    }
};

describe('starting or shutting down a device', () => {
    test('a refusal is said, with what the machine answered', async () => {
        expect(await controlDevice(refusing, phone, 'shutdown')).toBe(false);
        const toast = useToasts.getState().toasts.at(-1);
        expect(toast).toMatchObject({
            kind: 'error',
            title: 'Could not shut down iPhone 18 Pro',
            description: 'Unable to shutdown device in current state: Shutting Down'
        });
    });

    test('what goes through says nothing', async () => {
        const before = useToasts.getState().toasts.length;
        expect(await controlDevice(refusing, phone, 'boot')).toBe(true);
        expect(useToasts.getState().toasts).toHaveLength(before);
    });
});

describe('restarting or erasing a device', () => {
    function recording() {
        const calls: string[] = [];
        return {
            calls,
            boot: async (): Promise<DeviceInfo> => {
                calls.push('boot');
                return phone;
            },
            shutdown: async (): Promise<DeviceInfo> => {
                calls.push('shutdown');
                return { ...phone, state: 'shutdown' };
            },
            action: async (action: { action: string }): Promise<unknown> => {
                calls.push(action.action);
                return {};
            }
        };
    }

    test('a restart shuts the device down and starts it again', async () => {
        const client = recording();

        expect(await restartDevice(client, phone)).toBe(true);
        expect(client.calls).toEqual(['shutdown', 'boot']);
    });

    test('an erase shuts a running simulator down first and starts it again after', async () => {
        const client = recording();

        await eraseDevice(client, phone);
        expect(client.calls).toEqual(['shutdown', 'erase', 'boot']);
    });

    test('an emulator starts again by itself, and a stopped device stays stopped', async () => {
        const emulator = recording();
        await eraseDevice(emulator, { ...phone, platform: 'android', backendId: 'android' });
        const stopped = recording();
        await eraseDevice(stopped, { ...phone, state: 'shutdown' });

        expect(emulator.calls).toEqual(['shutdown', 'erase']);
        expect(stopped.calls).toEqual(['erase']);
    });
});
