import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { createDeviceHelperLauncher, DeviceHelperSource } from './helper-source.ts';
import { IosSimulatorBackend } from './ios-simulator.ts';

/*
 * Whether a simulator answers the side buttons a person presses through the helper's HID, which
 * decides whether a simulator announces them: the volume HUD shows on the screen within a moment.
 * It changes the volume of a simulator somebody booted already, so run it on a spare one.
 */
const simulators = process.platform === 'darwin' ? new IosSimulatorBackend() : null;
const booted = simulators === null ? undefined : (await simulators.list().catch(() => [])).find((device) => device.state === 'booted');
const helper = createDeviceHelperLauncher([process.execPath, resolve(import.meta.dir, '../main.ts'), 'device-helper']);

describe.skipIf(booted === undefined)('the side buttons of a booted simulator', () => {
    test('volume up shows the volume HUD', async () => {
        const source = new DeviceHelperSource(booted!.deviceId, helper, 2_000);
        await source.start(() => undefined);
        try {
            const before = await simulators!.screenshot(booted!.deviceId);
            source.input({ kind: 'button', button: 'volumeUp' });
            await Bun.sleep(400);
            const after = await simulators!.screenshot(booted!.deviceId);

            expect(Buffer.compare(Buffer.from(before), Buffer.from(after))).not.toBe(0);
        } finally {
            await source.stop();
        }
    });
});
