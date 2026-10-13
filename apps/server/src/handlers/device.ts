import type { DeviceControl } from '../devices/control.ts';
import type { DeviceManager } from '../devices/manager.ts';
import type { Dispatcher } from '../dispatcher.ts';
import { streamingGate } from './streaming.ts';

export function registerDeviceHandlers(dispatcher: Dispatcher, devices: DeviceManager, streamingAllowed: () => boolean): void {
    const requireStreaming = streamingGate(streamingAllowed);

    dispatcher.register('device.list', () => {
        requireStreaming();
        return devices.survey();
    });
    dispatcher.register('device.boot', (payload) => {
        requireStreaming();
        return devices.boot(payload.backendId, payload.platform, payload.deviceId);
    });
    dispatcher.register('device.shutdown', (payload) => {
        requireStreaming();
        return devices.shutdown(payload.backendId, payload.platform, payload.deviceId);
    });
    dispatcher.register('device.open', (payload, client) => {
        requireStreaming();
        return devices.open(payload.backendId, payload.platform, payload.deviceId, client.id, payload.stream, payload.formats, payload.binary);
    });
    // Detach lets a client clean up after the policy changed, so it stays open.
    dispatcher.register('device.detach', (payload, client) => {
        devices.detach(payload.backendId, payload.deviceId, client.id);
        return {};
    });
    dispatcher.register('device.input', async (payload, client) => {
        requireStreaming();
        await devices.input(payload.backendId, payload.deviceId, client.id, payload.input);
        return {};
    });
    dispatcher.register('device.detail', async (payload) => {
        requireStreaming();
        return { ...payload, settings: await devices.detail(payload.backendId, payload.platform, payload.deviceId) };
    });
    dispatcher.register('device.action', async (payload) => {
        requireStreaming();
        return {
            backendId: payload.backendId,
            platform: payload.platform,
            deviceId: payload.deviceId,
            settings: await devices.action(payload)
        };
    });
}

/* Not held to the streaming policy: they carry no picture, and a person pauses an agent from wherever they are. */
export function registerDeviceControlHandlers(dispatcher: Dispatcher, control: DeviceControl): void {
    dispatcher.register('device.operations', () => ({ devices: control.list() }));
    dispatcher.register('device.control', (payload) => control.control(payload, payload.mode));
}
